# backend/nl_query.py
"""Natural language query handler — feeds live state to an LLM and streams the answer.

Tries Anthropic → OpenAI (streaming). Falls through on failure.
"""
import json
import os
import re
import time
from typing import AsyncIterator

import requests


# Same classification used in state.py / Map.jsx so the LLM sees consistent labels
ADVERSARY_MIDS = {422, 273, 468, 445}
ADVERSARY_FLAGS = {"IR", "RU", "SY", "KP", "YE"}
SANCTIONED_MMSIS = {
    271000835, 271000836, 271000837,
    422023900, 422030700, 422060300, 422100600, 422112200, 422134400,
    422301600, 422310000, 422316000,
    657570200, 657570300, 657570400,
    511101390, 511101394, 538007800, 538008900, 577305000,
    352002785, 636091798,
}


def _categorize(v: dict) -> str:
    try:
        mmsi_int = int(v.get("mmsi", 0))
    except (TypeError, ValueError):
        mmsi_int = 0
    if mmsi_int in SANCTIONED_MMSIS:
        return "sanctioned"
    mid = mmsi_int // 1_000_000
    if mid in ADVERSARY_MIDS:
        return "adversary"
    flag = str(v.get("flag") or "").strip().upper()
    if flag in ADVERSARY_FLAGS:
        return "adversary"
    try:
        t = int(v.get("ship_type") or 0)
    except (TypeError, ValueError):
        t = 0
    if 80 <= t <= 89:
        return "tanker"
    if t in (35, 36):
        return "military"
    if 70 <= t <= 79:
        return "cargo"
    if t in (84, 85):
        return "lng"
    return "other"


def _vessel_line(v: dict) -> str:
    """One-line summary of a vessel for LLM context."""
    name = v.get("name") or "UNKNOWN"
    mmsi = v.get("mmsi")
    flag = v.get("flag") or "—"
    cat = _categorize(v)
    lat = v.get("lat")
    lon = v.get("lon")
    spd = v.get("speed")
    cog = v.get("course")
    hdg = v.get("heading")
    dest = v.get("destination") or ""
    nav = v.get("nav_status") or v.get("navStatus") or ""
    age = ""
    ts = v.get("_ts")
    if ts:
        secs = max(0, int(time.time() - ts))
        if secs < 3600:
            age = f", last seen {secs // 60}m ago"
        else:
            age = f", last seen {secs // 3600}h ago"

    # Heading is 511 when not available — show course instead
    bearing = None
    if hdg is not None and hdg != 511 and 0 <= hdg < 360:
        bearing = f"heading {int(hdg)}°"
    elif cog is not None and 0 <= cog < 360:
        bearing = f"COG {int(cog)}°"

    parts = [
        f"{name} (MMSI {mmsi}, {cat}, flag {flag})",
        f"pos {lat:.3f},{lon:.3f}" if lat is not None and lon is not None else None,
        f"{float(spd):.1f} kt" if spd is not None else None,
        bearing,
        f"bound for {dest}" if dest else None,
        f"status: {nav}" if nav else None,
    ]
    return "  · " + " | ".join(p for p in parts if p) + age


def _find_matching_vessels(question: str, vessels: list) -> list:
    """Best-effort match of vessels mentioned in the question."""
    q = question.upper()
    matched = []
    seen = set()

    # 1. Exact MMSI digits (6-10 consecutive digits)
    for mmsi_str in re.findall(r"\b\d{6,10}\b", question):
        for v in vessels:
            if str(v.get("mmsi")) == mmsi_str and v.get("mmsi") not in seen:
                matched.append(v)
                seen.add(v.get("mmsi"))

    # 2. Vessel names — match any vessel whose name appears as a word/substring
    # in the question. We require >=4 char names to avoid catching "OCEAN" in every sentence.
    for v in vessels:
        name = (v.get("name") or "").upper().strip()
        if len(name) < 4:
            continue
        if v.get("mmsi") in seen:
            continue
        # Token match: the full name (no spaces) should appear in the upper-cased question
        normalized = name.replace(" ", "")
        q_normalized = q.replace(" ", "")
        if normalized in q_normalized:
            matched.append(v)
            seen.add(v.get("mmsi"))

    return matched


def _build_context(question: str, state) -> str:
    now = time.time()
    # Filter to active vessels (same TTL as get_vessels)
    active = [v for v in state.vessels.values() if now - v.get("_ts", 0) < state.VESSEL_TTL]

    # Category counts
    counts = {}
    for v in active:
        c = _categorize(v)
        counts[c] = counts.get(c, 0) + 1

    events = list(state.events)[:30]
    briefing = state.briefing or {}

    context = (
        "You are a maritime intelligence analyst monitoring the Strait of Hormuz in real time.\n"
        "Answer the user's question using ONLY the live data provided below. "
        "If the data doesn't contain the answer, say so — do NOT invent vessel positions, "
        "courses, destinations or incidents. Be concise and specific. When citing a vessel, "
        "include MMSI, category, flag, position, and speed where relevant.\n\n"
        f"SITUATION: {len(active)} active vessels · risk {state.risk_score}/100\n"
        "  Breakdown: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) + "\n"
    )

    brief_text = briefing.get("text") or briefing.get("headline")
    if brief_text:
        context += f"  Briefing: {brief_text[:300]}\n"

    # Vessels matching the question (by MMSI or name)
    matched = _find_matching_vessels(question, active)
    if matched:
        context += f"\nVESSELS MENTIONED IN QUESTION ({len(matched)}):\n"
        for v in matched[:10]:
            context += _vessel_line(v) + "\n"

    # Notable vessels always included so the LLM has priors for "what's suspicious"
    sanctioned = [v for v in active if _categorize(v) == "sanctioned"]
    adversary = [v for v in active if _categorize(v) == "adversary"]
    military = [v for v in active if _categorize(v) == "military"]

    notable_mmsis = {v.get("mmsi") for v in matched}
    if sanctioned:
        rest = [v for v in sanctioned if v.get("mmsi") not in notable_mmsis]
        if rest:
            context += f"\nSANCTIONED VESSELS ACTIVE ({len(sanctioned)}):\n"
            for v in rest[:8]:
                context += _vessel_line(v) + "\n"
    if adversary:
        rest = [v for v in adversary if v.get("mmsi") not in notable_mmsis]
        if rest:
            context += f"\nADVERSARY-FLAGGED VESSELS ({len(adversary)} total, sample):\n"
            for v in rest[:8]:
                context += _vessel_line(v) + "\n"
    if military:
        rest = [v for v in military if v.get("mmsi") not in notable_mmsis]
        if rest:
            context += f"\nMILITARY VESSELS ({len(military)} total, sample):\n"
            for v in rest[:6]:
                context += _vessel_line(v) + "\n"

    if events:
        context += "\nRECENT INTELLIGENCE EVENTS:\n"
        for ev in events[:15]:
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
