import logging
import os
import ssl

import grpc
import httpx
from grpc import aio
from opentelemetry.instrumentation.grpc import aio_server_interceptor
from opentelemetry.trace import TracerProvider
from sifer.v1 import orchestrator_pb2_grpc

from sifer_orchestrator.config import Config, TLSFiles
from sifer_orchestrator.engines import load_engines
from sifer_orchestrator.resolver import Resolver
from sifer_orchestrator.service import OrchestratorService

log = logging.getLogger(__name__)


def server_credentials(files: TLSFiles) -> grpc.ServerCredentials:
    return grpc.ssl_server_credentials(
        [(files.key.read_bytes(), files.cert.read_bytes())],
        root_certificates=files.ca.read_bytes(),
        require_client_auth=True,
    )


def trust() -> ssl.SSLContext:
    context = ssl.create_default_context()
    extra = os.environ.get("SSL_CERT_FILE") or ""
    if extra:
        context.load_verify_locations(cafile=extra)
    return context


def engine_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(verify=trust(), timeout=httpx.Timeout(120.0, connect=5.0))


async def start(
    config: Config,
    tracer_provider: TracerProvider | None = None,
    resolver: Resolver | None = None,
) -> tuple[aio.Server, int]:
    server = aio.server(interceptors=[aio_server_interceptor(tracer_provider=tracer_provider)])
    orchestrator_pb2_grpc.add_OrchestratorServiceServicer_to_server(
        OrchestratorService(resolver), server
    )
    if config.tls is None:
        port = server.add_insecure_port(config.addr)
    else:
        port = server.add_secure_port(config.addr, server_credentials(config.tls))
    if port == 0:
        raise RuntimeError(f"cannot bind {config.addr}")
    await server.start()
    return server, port


async def serve(config: Config) -> None:
    rows = load_engines(config.engines_file) if config.engines_file else ()
    async with engine_client() as client:
        resolver = Resolver(rows, client) if rows else None
        server, _ = await start(config, resolver=resolver)
        log.info(
            "orchestrator listening",
            extra={
                "addr": config.addr,
                "otlp": config.otlp_endpoint,
                "mtls": config.tls is not None,
                "engines": [row.name for row in rows],
            },
        )
        try:
            await server.wait_for_termination()
        finally:
            log.info("orchestrator shutting down")
            await server.stop(config.shutdown_grace_s)
