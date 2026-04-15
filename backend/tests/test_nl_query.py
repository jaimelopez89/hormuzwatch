# backend/tests/test_nl_query.py
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class AsyncIterator:
    """Synchronous-list-backed async iterator — works in all Python 3.10+ envs."""

    def __init__(self, items):
        self._iter = iter(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class StreamContextManager:
    """
    Async context manager that behaves like anthropic's stream object:
    - ``async with stream_cm as s:`` returns self
    - ``s.text_stream`` is an async iterable over the provided tokens
    """

    def __init__(self, tokens):
        self.text_stream = AsyncIterator(tokens)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def make_stream_cm(tokens):
    return StreamContextManager(tokens)


def make_mock_state(vessels=5, risk_score=25, events=None, briefing=None, market=None):
    state = MagicMock()
    state.vessels = {i: {} for i in range(vessels)}
    state.risk_score = risk_score
    state.events = events or [
        {
            "severity": "HIGH",
            "type": "GEOFENCE_BREACH",
            "description": "Tanker entered restricted zone",
        },
        {
            "severity": "CRITICAL",
            "type": "MULTI_SIGNAL",
            "description": "Correlated threat detected",
        },
    ]
    state.briefing = briefing or {
        "headline": "Strait remains open",
        "body": "No significant disruptions.",
    }
    state.market = market or {"CRUDE": {"price": 82.5, "change_pct": 1.2}}
    state.get_throughput = MagicMock(
        return_value=[{"date": "2026-04-14", "tankerCount": 14, "barrelsPerDay": 14000000}]
    )
    return state


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stream_answer_yields_tokens(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    tokens = ["The ", "strait ", "is ", "open."]
    stream_cm = make_stream_cm(tokens)

    mock_client = MagicMock()
    mock_client.messages.stream = MagicMock(return_value=stream_cm)

    with patch("anthropic.AsyncAnthropic", return_value=mock_client):
        import importlib
        import nl_query
        importlib.reload(nl_query)

        state = make_mock_state()
        collected = []
        async for tok in nl_query.stream_answer("Is Hormuz open?", state):
            collected.append(tok)

    assert collected == tokens


@pytest.mark.asyncio
async def test_stream_answer_includes_vessel_count_in_context(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    captured_kwargs: list[dict] = []

    def capture_stream(**kwargs):
        captured_kwargs.append(kwargs)
        return make_stream_cm(["test"])

    mock_client = MagicMock()
    mock_client.messages.stream = capture_stream

    with patch("anthropic.AsyncAnthropic", return_value=mock_client):
        import importlib
        import nl_query
        importlib.reload(nl_query)

        state = make_mock_state(vessels=42, risk_score=67)
        async for _ in nl_query.stream_answer("How many vessels?", state):
            pass

    assert len(captured_kwargs) == 1
    messages = captured_kwargs[0]["messages"]
    assert len(messages) == 1
    context = messages[0]["content"]
    assert "42" in context, "Vessel count should appear in context"
    assert "67" in context, "Risk score should appear in context"
