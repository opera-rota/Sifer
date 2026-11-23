import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

APIS = frozenset({"anthropic-messages"})
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


class EngineConfigError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class EngineRow:
    name: str
    api: str
    base_url: str
    model: str
    timeout_s: float
    api_key: str = field(repr=False)


def _text(entry: Mapping[str, object], key: str, row: str) -> str:
    value = entry.get(key)
    if not isinstance(value, str) or not value.strip():
        raise EngineConfigError(f"engine {row!r} needs a non-empty {key!r}")
    return value.strip()


def _timeout(entry: Mapping[str, object], row: str) -> float:
    value = entry.get("timeout_s")
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 < value <= 120:
        raise EngineConfigError(f"engine {row!r} needs timeout_s between 0 and 120 seconds")
    return float(value)


def _base_url(value: str, row: str) -> str:
    parts = urlsplit(value)
    secure = parts.scheme == "https" and bool(parts.hostname)
    local = parts.scheme == "http" and parts.hostname in LOOPBACK_HOSTS
    if not (secure or local) or parts.query or parts.fragment:
        raise EngineConfigError(f"engine {row!r} base_url must be https, or http on loopback")
    return value.rstrip("/")


def _row(entry: object, env: Mapping[str, str], index: int) -> EngineRow:
    if not isinstance(entry, dict):
        raise EngineConfigError(f"engine #{index + 1} is not an object")
    name = _text(entry, "name", f"#{index + 1}")
    api = _text(entry, "api", name)
    if api not in APIS:
        raise EngineConfigError(f"engine {name!r} api {api!r} is not one of {sorted(APIS)}")
    key_env = _text(entry, "key_env", name)
    api_key = env.get(key_env, "").strip()
    if not api_key:
        raise EngineConfigError(f"engine {name!r} needs its key in {key_env}")
    return EngineRow(
        name=name,
        api=api,
        base_url=_base_url(_text(entry, "base_url", name), name),
        model=_text(entry, "model", name),
        timeout_s=_timeout(entry, name),
        api_key=api_key,
    )


def parse_engines(document: str, env: Mapping[str, str]) -> tuple[EngineRow, ...]:
    try:
        data = json.loads(document)
    except json.JSONDecodeError as error:
        raise EngineConfigError(f"engines file is not JSON: {error.msg}") from None
    entries = data.get("text") if isinstance(data, dict) else None
    if not isinstance(entries, list) or not entries:
        raise EngineConfigError("engines file needs a non-empty 'text' list")
    rows = tuple(_row(entry, env, index) for index, entry in enumerate(entries))
    names = [row.name for row in rows]
    if len(set(names)) != len(names):
        raise EngineConfigError("engine names must be unique")
    return rows


def load_engines(path: Path, env: Mapping[str, str] | None = None) -> tuple[EngineRow, ...]:
    return parse_engines(path.read_text(encoding="utf-8"), os.environ if env is None else env)
