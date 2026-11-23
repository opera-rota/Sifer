from typing import override

import grpc
from grpc import aio
from sifer.v1 import interaction_pb2, orchestrator_pb2, orchestrator_pb2_grpc

from sifer_orchestrator.resolver import NoEngineAvailableError, Request, Resolver
from sifer_orchestrator.schema import SCHEMA_MAJOR

MAX_CONTENT_CHARS = 20_000
MAX_INSTRUCTION_CHARS = 1_000

EchoContext = aio.ServicerContext[orchestrator_pb2.EchoRequest, orchestrator_pb2.EchoResponse]
ResolveContext = aio.ServicerContext[
    orchestrator_pb2.ResolveRequest, orchestrator_pb2.ResolveResponse
]


def _request(message: orchestrator_pb2.ResolveRequest) -> Request | str:
    content = message.drop_context.content.strip()
    instruction = message.instruction.text.strip()
    if not content:
        return "drop_context.content is required"
    if len(content) > MAX_CONTENT_CHARS:
        return f"drop_context.content is longer than {MAX_CONTENT_CHARS} characters"
    if not instruction:
        return "instruction.text is required"
    if len(instruction) > MAX_INSTRUCTION_CHARS:
        return f"instruction.text is longer than {MAX_INSTRUCTION_CHARS} characters"
    return Request(
        content=content,
        instruction=instruction,
        app_key=message.drop_context.app_key.strip(),
        element_role=message.drop_context.element_role.strip(),
    )


class OrchestratorService(orchestrator_pb2_grpc.OrchestratorServiceServicer):
    def __init__(self, resolver: Resolver | None = None) -> None:
        self._resolver = resolver

    @override
    async def Echo(
        self,
        request: orchestrator_pb2.EchoRequest,
        context: EchoContext,
    ) -> orchestrator_pb2.EchoResponse:
        if not request.HasField("envelope"):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "envelope is required")
        major = request.envelope.schema_major
        if major != SCHEMA_MAJOR:
            await context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                f"schema_major {major} is not supported; expected {SCHEMA_MAJOR}",
            )
        return orchestrator_pb2.EchoResponse(envelope=request.envelope)

    @override
    async def Resolve(
        self,
        request: orchestrator_pb2.ResolveRequest,
        context: ResolveContext,
    ) -> orchestrator_pb2.ResolveResponse:
        parsed = _request(request)
        if isinstance(parsed, str):
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, parsed)
        if self._resolver is None:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, "no text engine is configured")
        try:
            resolution = await self._resolver.resolve(parsed)
        except NoEngineAvailableError as error:
            await context.abort(grpc.StatusCode.UNAVAILABLE, str(error))
        return orchestrator_pb2.ResolveResponse(
            fix_plan=interaction_pb2.FixPlan(
                fix_key=resolution.fix_key,
                replacement=resolution.replacement,
                expect_prefix=resolution.expect_prefix,
                engine=resolution.engine,
                fallback=resolution.fallback,
            )
        )
