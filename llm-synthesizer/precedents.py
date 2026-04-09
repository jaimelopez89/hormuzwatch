"""Load historical Hormuz incident precedents for LLM context."""
import json
import os

_DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "reference-data", "precedents", "hormuz_incidents.json")


def load_precedents() -> list[dict]:
    with open(_DATA_PATH) as f:
        return json.load(f)


def format_for_prompt(precedents: list[dict]) -> str:
    lines = ["Historical Hormuz incidents and market impact:"]
    for p in precedents:
        lines.append(
            f"- {p['date']} {p['description']}: "
            f"Brent {p['brent_impact_usd']}, WTI {p['wti_impact_pct']}, "
            f"Tankers: {p['tanker_stocks_impact']}"
        )
    return "\n".join(lines)
