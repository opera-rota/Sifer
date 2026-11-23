import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

from sifer_orchestrator.engines import EngineRow

ANTHROPIC_VERSION = "2023-06-01"


class EngineError(Exception):
    pass


class EngineTimeoutError(EngineError):
    pass


@dataclass(frozen=True, slots=True)
class Prompt:
    system: str
    user: str
    max_tokens: int


Adapter = Callable[[httpx.AsyncClient, EngineRow, Prompt], Awaitable[str]]


async def anthropic_messages(client: httpx.AsyncClient, row: EngineRow, prompt: Prompt) -> str:
    response = await client.post(
        f"{row.base_url}/v1/messages",
        headers={"x-api-key": row.api_key, "anthropic-version": ANTHROPIC_VERSION},
        json={
            "model": row.model,
            "max_tokens": prompt.max_tokens,
            "system": prompt.system,
            "messages": [{"role": "user", "content": prompt.user}],
        },
    )
    if response.status_code != httpx.codes.OK:
        raise EngineError(f"engine answered HTTP {response.status_code}")
    body = response.json()
    if body.get("stop_reason") != "end_turn":
        raise EngineError(f"engine stopped with {body.get('stop_reason')!r}")
    blocks = body.get("content")
    if not isinstance(blocks, list):
        raise EngineError("engine answer has no content")
    return "".join(
        block["text"]
        for block in blocks
        if isinstance(block, dict)
        and block.get("type") == "text"
        and isinstance(block.get("text"), str)
    )


ADAPTERS: dict[str, Adapter] = {"anthropic-messages": anthropic_messages}


async def complete(client: httpx.AsyncClient, row: EngineRow, prompt: Prompt) -> str:
    adapter = ADAPTERS[row.api]
    try:
        async with asyncio.timeout(row.timeout_s):
            text = await adapter(client, row, prompt)
    except TimeoutError:
        raise EngineTimeoutError(f"engine gave no answer within {row.timeout_s} s") from None
    except httpx.HTTPError as error:
        raise EngineError(f"engine unreachable: {type(error).__name__}") from None
    except ValueError:
        raise EngineError("engine answer is not JSON") from None
    text = text.strip()
    if not text:
        raise EngineError("engine answer is empty")
    return text
