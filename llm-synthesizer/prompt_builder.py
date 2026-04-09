"""Assemble the context window sent to Claude."""


SYSTEM_PROMPT = """You are a maritime intelligence analyst specializing in geopolitical risk in the Strait of Hormuz.
You provide concise, authoritative situation reports that connect vessel activity to market implications.
Your tone is direct and precise — like a briefing for a senior trader or analyst.
Always ground your market outlook in the historical precedents provided."""


def build_prompt(risk_score: int, events: list[dict], news: list[dict],
                 market: list[dict], precedents: str) -> str:
    events_text = "\n".join(
        f"- [{e.get('severity','?')}] {e.get('type','?')}: {e.get('description','')}"
        for e in events[-10:]
    ) or "No significant events in last window."

    news_text = "\n".join(
        f"- [{'+' if n.get('sentiment',0) >= 0 else '-'}{abs(n.get('sentiment',0))}] {n.get('headline','')}"
        for n in news[-5:]
    ) or "No relevant news."

    market_text = "\n".join(
        f"- {m['name']} ({m['symbol']}): ${m['price']} ({'+' if m['change_pct'] >= 0 else ''}{m['change_pct']}%)"
        for m in market
    ) or "No market data."

    return f"""{SYSTEM_PROMPT}

Current composite risk score: {risk_score}/100

ACTIVE INTELLIGENCE EVENTS:
{events_text}

RECENT NEWS (sentiment: - = escalatory, + = de-escalatory):
{news_text}

MARKET SNAPSHOT:
{market_text}

{precedents}

Generate a situation report as valid JSON with exactly these fields:
{{
  "headline": "one sentence, punchy, under 15 words",
  "body": "3-5 sentences analyst briefing",
  "risk_score": {risk_score},
  "key_drivers": ["driver1", "driver2", "driver3"],
  "market_outlook": "1-2 sentences on commodity/equity implications citing precedents where relevant",
  "confidence": "LOW|MEDIUM|HIGH"
}}

Respond with only the JSON object, no markdown fences."""
