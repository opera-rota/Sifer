import json
from pathlib import Path

import pytest

from sifer_orchestrator.engines import EngineConfigError, load_engines, parse_engines

KEY_ENV = {"SIFER_ENGINE_KEY_TEST": "sk-test-secret"}


def row(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "name": "primary",
        "api": "anthropic-messages",
        "base_url": "https://api.example.test/",
        "model": "model-a",
        "key_env": "SIFER_ENGINE_KEY_TEST",
        "timeout_s": 3,
    }
    base.update(overrides)
    return base


def document(*rows: dict[str, object]) -> str:
    return json.dumps({"text": list(rows)})


def test_parses_rows_in_order() -> None:
    rows = parse_engines(document(row(), row(name="fallback", timeout_s=20.5)), KEY_ENV)
    assert [r.name for r in rows] == ["primary", "fallback"]
    assert rows[0].base_url == "https://api.example.test"
    assert rows[0].api_key == "sk-test-secret"
    assert rows[1].timeout_s == 20.5


def test_key_never_appears_in_repr() -> None:
    (parsed,) = parse_engines(document(row()), KEY_ENV)
    assert "sk-test-secret" not in repr(parsed)


def test_repository_engines_file_is_valid() -> None:
    path = Path(__file__).parents[3] / "infra" / "local" / "engines.json"
    rows = load_engines(path, {"SIFER_ENGINE_KEY_ANTHROPIC": "sk-ant-api03-test"})
    assert [r.model for r in rows] == ["claude-haiku-5-5", "claude-sonnet-5-5"]


def test_loopback_http_is_allowed() -> None:
    (parsed,) = parse_engines(document(row(base_url="http://127.0.0.1:11434")), KEY_ENV)
    assert parsed.base_url == "http://127.0.0.1:11434"


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"api": "openai"}, "is not one of"),
        ({"base_url": "http://api.example.test"}, "base_url"),
        ({"base_url": "https://api.example.test?x=1"}, "base_url"),
        ({"model": " "}, "'model'"),
        ({"timeout_s": 0}, "timeout_s"),
        ({"timeout_s": True}, "timeout_s"),
        ({"key_env": "SIFER_MISSING"}, "SIFER_MISSING"),
    ],
)
def test_rejects_bad_rows(overrides: dict[str, object], message: str) -> None:
    with pytest.raises(EngineConfigError, match=message):
        parse_engines(document(row(**overrides)), KEY_ENV)


@pytest.mark.parametrize("text", ["not json", "{}", '{"text": []}', '{"text": [1]}'])
def test_rejects_bad_documents(text: str) -> None:
    with pytest.raises(EngineConfigError):
        parse_engines(text, KEY_ENV)


def test_rejects_duplicate_names() -> None:
    with pytest.raises(EngineConfigError, match="unique"):
        parse_engines(document(row(), row()), KEY_ENV)
