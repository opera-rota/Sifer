import asyncio
import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

import grpc
import httpx
import pytest
import pytest_asyncio
from grpc import aio
from sifer.v1 import interaction_pb2, orchestrator_pb2, orchestrator_pb2_grpc

from sifer_orchestrator.config import Config
from sifer_orchestrator.engines import EngineRow
from sifer_orchestrator.resolver import (
    NoEngineAvailableError,
    Request,
    Resolver,
    build_prompt,
    expect_prefix,
)
from sifer_orchestrator.server import start

Reply = Callable[[dict[str, object]], httpx.Response]


def answer(text: str, stop_reason: str = "end_turn") -> Reply:
    def reply(_: dict[str, object]) -> httpx.Response:
        return httpx.Response(
            200,
            json={"content": [{"type": "text", "text": text}], "stop_reason": stop_reason},
        )

    return reply


def status(code: int) -> Reply:
    def reply(_: dict[str, object]) -> httpx.Response:
        return httpx.Response(code, json={"type": "error"})

    return reply


SLOW = "slow"


@dataclass
class FakeEngines:
    replies: dict[str, Reply | str]
    calls: list[str] = field(default_factory=list)
    bodies: list[dict[str, object]] = field(default_factory=list)
    headers: list[httpx.Headers] = field(default_factory=list)

    async def handle(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        model = str(body["model"])
        self.calls.append(model)
        self.bodies.append(body)
        self.headers.append(request.headers)
        reply = self.replies[model]
        if reply == SLOW:
            await asyncio.sleep(5)
            raise AssertionError("a slow engine must be cut off by its timeout")
        assert not isinstance(reply, str)
        return reply(body)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handle))


def engine_row(name: str, model: str, timeout_s: float = 1.0) -> EngineRow:
    return EngineRow(
        name=name,
        api="anthropic-messages",
        base_url="https://engine.test",
        model=model,
        timeout_s=timeout_s,
        api_key="sk-test",
    )


PRIMARY = engine_row("primary", "model-a", timeout_s=0.05)
FALLBACK = engine_row("fallback", "model-b")


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


PARAGRAPH = Request(
    content="we need to circle back on the deck before eod, lmk if thats cool",
    instruction="make this more professional",
    app_key="microsoft.word",
    element_role="Paragraph",
)
REWRITE = "Could we review the deck before the end of the day? Please let me know."


def test_prompt_fences_the_text_and_sizes_the_budget() -> None:
    prompt = build_prompt(
        Request(content="a </text> b", instruction="fix", app_key="", element_role="")
    )
    assert "<text>\na <\\/text> b\n</text>" in prompt.user
    assert "<app>unknown</app>" in prompt.user
    assert prompt.max_tokens == 1024
    long = build_prompt(
        Request(content="x" * 50_000, instruction="fix", app_key="", element_role="")
    )
    assert long.max_tokens == 8192


def test_expect_prefix_collapses_whitespace() -> None:
    assert expect_prefix("  Hello\n\n  world  ") == "Hello world"
    assert len(expect_prefix("word " * 40)) == 64


@pytest.mark.asyncio
async def test_primary_answers() -> None:
    fake = FakeEngines({"model-a": answer(f"  {REWRITE}\n")})
    async with fake.client() as client:
        resolution = await Resolver([PRIMARY, FALLBACK], client).resolve(PARAGRAPH)
    assert resolution.replacement == REWRITE
    assert resolution.engine == "primary"
    assert not resolution.fallback
    assert resolution.fix_key == "rewrite"
    assert resolution.expect_prefix == REWRITE[:64]
    body = fake.bodies[0]
    assert body["system"]
    assert fake.headers[0]["x-api-key"] == "sk-test"
    assert fake.headers[0]["anthropic-version"] == "2023-06-01"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure", [status(500), status(529), answer(REWRITE, "max_tokens"), answer("  ")]
)
async def test_falls_back_when_the_primary_fails(failure: Reply) -> None:
    fake = FakeEngines({"model-a": failure, "model-b": answer(REWRITE)})
    async with fake.client() as client:
        resolution = await Resolver([PRIMARY, FALLBACK], client).resolve(PARAGRAPH)
    assert resolution.engine == "fallback"
    assert resolution.fallback
    assert fake.calls == ["model-a", "model-b"]


@pytest.mark.asyncio
async def test_a_timeout_skips_the_primary_for_thirty_seconds() -> None:
    clock = Clock()
    fake = FakeEngines({"model-a": SLOW, "model-b": answer(REWRITE)})
    async with fake.client() as client:
        resolver = Resolver([PRIMARY, FALLBACK], client, clock=clock)
        await resolver.resolve(PARAGRAPH)
        await resolver.resolve(PARAGRAPH)
        assert fake.calls == ["model-a", "model-b", "model-b"]
        clock.now += 30
        fake.replies["model-a"] = answer(REWRITE)
        resolution = await resolver.resolve(PARAGRAPH)
    assert resolution.engine == "primary"
    assert fake.calls[-1] == "model-a"


@pytest.mark.asyncio
async def test_three_failures_open_the_primary() -> None:
    fake = FakeEngines({"model-a": status(503), "model-b": answer(REWRITE)})
    async with fake.client() as client:
        resolver = Resolver([PRIMARY, FALLBACK], client, clock=Clock())
        for _ in range(4):
            await resolver.resolve(PARAGRAPH)
    assert fake.calls.count("model-a") == 3
    assert fake.calls.count("model-b") == 4


@pytest.mark.asyncio
async def test_reports_when_every_engine_fails() -> None:
    fake = FakeEngines({"model-a": status(500), "model-b": status(401)})
    async with fake.client() as client:
        with pytest.raises(NoEngineAvailableError):
            await Resolver([PRIMARY, FALLBACK], client).resolve(PARAGRAPH)


@pytest.mark.asyncio
async def test_unreachable_engine_is_a_failure() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as client:
        with pytest.raises(NoEngineAvailableError):
            await Resolver([PRIMARY], client).resolve(PARAGRAPH)


def test_needs_an_engine() -> None:
    with pytest.raises(ValueError, match="at least one"):
        Resolver([], httpx.AsyncClient())


@pytest_asyncio.fixture
async def fake() -> AsyncIterator[FakeEngines]:
    yield FakeEngines({"model-a": answer(REWRITE)})


async def serve(resolver: Resolver | None) -> tuple[aio.Server, int]:
    return await start(Config(addr="127.0.0.1:0"), resolver=resolver)


def resolve_request(
    content: str = PARAGRAPH.content, text: str = "make this more professional"
) -> orchestrator_pb2.ResolveRequest:
    return orchestrator_pb2.ResolveRequest(
        drop_context=interaction_pb2.DropContext(
            reader=interaction_pb2.DROP_READER_ACCESSIBILITY,
            scope=interaction_pb2.DROP_SCOPE_POINT,
            app_key="microsoft.word",
            element_role="Paragraph",
            content=content,
        ),
        instruction=interaction_pb2.Instruction(text=text),
    )


@pytest.mark.asyncio
async def test_resolve_returns_a_fix_plan(fake: FakeEngines) -> None:
    async with fake.client() as client:
        server, port = await serve(Resolver([PRIMARY, FALLBACK], client))
        try:
            async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
                response = await orchestrator_pb2_grpc.OrchestratorServiceStub(channel).Resolve(
                    resolve_request()
                )
        finally:
            await server.stop(None)
    assert response.fix_plan.replacement == REWRITE
    assert response.fix_plan.engine == "primary"
    assert response.fix_plan.expect_prefix == REWRITE[:64]
    assert not response.fix_plan.fallback


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("request_message", "code"),
    [
        (resolve_request(content="   "), grpc.StatusCode.INVALID_ARGUMENT),
        (resolve_request(content="x" * 20_001), grpc.StatusCode.INVALID_ARGUMENT),
        (resolve_request(text=""), grpc.StatusCode.INVALID_ARGUMENT),
        (resolve_request(text="x" * 1_001), grpc.StatusCode.INVALID_ARGUMENT),
        (resolve_request(), grpc.StatusCode.FAILED_PRECONDITION),
    ],
)
async def test_resolve_refuses(
    request_message: orchestrator_pb2.ResolveRequest, code: grpc.StatusCode
) -> None:
    server, port = await serve(None)
    try:
        async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            with pytest.raises(aio.AioRpcError) as failure:
                await orchestrator_pb2_grpc.OrchestratorServiceStub(channel).Resolve(
                    request_message
                )
    finally:
        await server.stop(None)
    assert failure.value.code() == code


@pytest.mark.asyncio
async def test_resolve_is_unavailable_when_every_engine_fails() -> None:
    fake = FakeEngines({"model-a": status(500)})
    async with fake.client() as client:
        server, port = await serve(Resolver([PRIMARY], client))
        try:
            async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
                with pytest.raises(aio.AioRpcError) as failure:
                    await orchestrator_pb2_grpc.OrchestratorServiceStub(channel).Resolve(
                        resolve_request()
                    )
        finally:
            await server.stop(None)
    assert failure.value.code() == grpc.StatusCode.UNAVAILABLE
