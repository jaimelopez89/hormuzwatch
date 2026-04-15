# backend/nl_query.py
"""Natural language query handler — feeds live state to Claude and streams the answer."""
import os
from typing import AsyncIterator


async def stream_answer(question: str, state) -> AsyncIterator[str]:
    """Yield answer tokens one by one as Claude generates them."""
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

    events = list(state.events)[:50]
    briefing = state.briefing or {}
    market_snapshot = {
        sym: {"price": t.get("price"), "change_pct": t.get("change_pct")}
        for sym, t in list(state.market.items())[:10]
    }

    context = (
        "You are a maritime intelligence analyst monitoring the Strait of Hormuz in real time.\n"
        "Your data is sourced from live AIS vessel tracking, news feeds, and commodity markets, "
        "all processed by Apache Flink on Ververica Cloud.\n\n"
        f"Active vessels: {len(state.vessels)} | Risk score: {state.risk_score}/100\n"
        f"Latest briefing: {briefing.get('headline', 'None yet')}\n\n"
        "RECENT INTELLIGENCE EVENTS:\n"
    )
    for ev in events[:20]:
        context += f"  [{ev.get('severity','?')}] {ev.get('type','?')} — {ev.get('description','')}\n"

    context += f"\nQUESTION: {question}\n"

    async with client.messages.stream(
        model="claude-opus-4-6",
        max_tokens=800,
        messages=[{"role": "user", "content": context}],
    ) as stream:
        async for text in stream.text_stream:
            yield text
