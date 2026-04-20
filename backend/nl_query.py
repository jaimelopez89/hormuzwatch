# backend/nl_query.py
"""Natural language query handler — feeds live state to an LLM and streams the answer.

Tries Anthropic → OpenAI (streaming). Falls through on failure.
"""
import json
import os
from typing import AsyncIterator

import requests


def _build_context(question: str, state) -> str:
    events = list(state.events)[:50]
    briefing = state.briefing or {}
    context = (
        "You are a maritime intelligence analyst monitoring the Strait of Hormuz in real time.\n"
        "Your data is sourced from live AIS vessel tracking, news feeds, and commodity markets.\n\n"
        f"Active vessels: {len(state.vessels)} | Risk score: {state.risk_score}/100\n"
        f"Latest briefing summary: {(briefing.get('text') or briefing.get('headline') or 'None yet')[:200]}\n\n"
        "RECENT INTELLIGENCE EVENTS:\n"
    )
    for ev in events[:20]:
        context += f"  [{ev.get('severity','?')}] {ev.get('type','?')} — {ev.get('description','')}\n"
    context += f"\nQUESTION: {question}\n"
    return context


async def stream_answer(question: str, state) -> AsyncIterator[str]:
    """Yield answer tokens. Tries Anthropic streaming, then OpenAI streaming."""
    context = _build_context(question, state)

    # ── Try Anthropic ──
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            import anthropic
            client = anthropic.AsyncAnthropic(api_key=anthropic_key)
            async with client.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=800,
                messages=[{"role": "user", "content": context}],
            ) as stream:
                async for text in stream.text_stream:
                    yield text
            return
        except Exception:
            pass  # fall through to OpenAI

    # ── Try OpenAI ──
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            resp = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {openai_key}"},
                json={
                    "model": "gpt-4o-mini",
                    "max_tokens": 800,
                    "stream": True,
                    "messages": [{"role": "user", "content": context}],
                },
                stream=True,
                timeout=30,
            )
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                line = line.decode("utf-8")
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                chunk = json.loads(data)
                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                if delta:
                    yield delta
            return
        except Exception:
            pass

    yield "Error: no LLM API keys available. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."
