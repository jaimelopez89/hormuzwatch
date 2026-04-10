"""
Polymarket poller — fetches Strait of Hormuz prediction market odds.

Source: Polymarket Gamma API (public, no API key required)
Produces to Kafka topic: market-ticks (extended with prediction markets)

The Hormuz market resolves based on IMF PortWatch hitting 60+ daily transits
on a 7-day moving average. Market price = YES probability (0-1).
"""
import json
import logging
import re
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

GAMMA_BASE = "https://gamma-api.polymarket.com"
TOPIC = "market-ticks"
POLL_INTERVAL = 5 * 60  # 5 minutes

# Search terms covering Iran conflict + commodity/macro markets
SEARCH_TERMS = [
    "hormuz", "iran war", "iran attack", "iran nuclear",
    "oil price", "crude oil", "brent", "wti",
    "inflation", "cpi", "recession",
    "persian gulf", "middle east war",
]

# Keyword filter — whole-word match to avoid false positives like "Oilers"→"oil"
RELEVANT_KEYWORDS = [
    "iran", "hormuz", "strait", "persian gulf", "middle east",
    "crude oil", "oil price", "oil barrel", "brent", "wti", "opec",
    "inflation", "cpi", "federal reserve", "fed rate", "recession",
    "iran war", "iran attack", "iran nuclear", "nuclear deal",
    "sanctions", "embargo", "energy crisis",
    "commodity prices", "commodities",
]

_KW_PATTERNS = [re.compile(r'\b' + re.escape(kw) + r'\b', re.I) for kw in RELEVANT_KEYWORDS]


def is_relevant(market: dict) -> bool:
    text = market.get("question", "") + " " + market.get("description", "")
    return any(p.search(text) for p in _KW_PATTERNS)


def fetch_hormuz_markets() -> list[dict]:
    """Find active Polymarket markets related to Hormuz."""
    markets = []
    seen = set()
    for term in SEARCH_TERMS:
        try:
            resp = requests.get(
                f"{GAMMA_BASE}/markets",
                params={"search": term, "active": "true", "closed": "false"},
                timeout=15,
            )
            if resp.status_code != 200:
                continue
            for m in resp.json():
                if m.get("id") in seen:
                    continue
                seen.add(m.get("id"))
                markets.append(m)
        except Exception:
            pass
    return markets


def fetch_all_hormuz_markets() -> list[dict]:
    """Also check closed/resolved markets for recent history."""
    markets = []
    try:
        resp = requests.get(
            f"{GAMMA_BASE}/markets",
            params={"search": "hormuz", "limit": 20},
            timeout=15,
        )
        if resp.status_code == 200:
            markets = resp.json()
    except Exception:
        pass
    return markets


def parse_market(m: dict) -> dict | None:
    try:
        prices_raw = m.get("outcomePrices", "[]")
        prices = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
        yes_prob = float(prices[0]) * 100 if prices else None

        return {
            "symbol": f"POLY:{m.get('slug', m.get('id', ''))[:20]}",
            "name": m.get("question", "Hormuz Market")[:60],
            "price": round(yes_prob, 1) if yes_prob is not None else None,
            "change_pct": 0,  # would need historical to compute
            "volume": m.get("volumeNum") or m.get("volume") or 0,
            "end_date": m.get("endDate"),
            "active": m.get("active", False),
            "closed": m.get("closed", False),
            "question": m.get("question", ""),
            "yes_probability": round(yes_prob, 1) if yes_prob is not None else None,
            "market_type": "prediction",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception:
        return None


def run():
    from kafka_utils import make_producer
    producer = make_producer()
    log.info("Polymarket poller started.")

    while True:
        try:
            markets = fetch_hormuz_markets()
            if not markets:
                # Fall back to all (including resolved)
                markets = fetch_all_hormuz_markets()

            sent = 0
            for m in markets:
                if not is_relevant(m):
                    continue
                parsed = parse_market(m)
                if parsed and parsed["price"] is not None:
                    producer.send(TOPIC, parsed)
                    sent += 1
                    log.info(
                        f"Polymarket: {parsed['name'][:50]} — "
                        f"YES {parsed['yes_probability']}% | vol ${parsed['volume']:,.0f}"
                    )
            if not sent:
                log.info("No active Hormuz Polymarket markets found.")
        except Exception as e:
            log.warning(f"Polymarket error: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
