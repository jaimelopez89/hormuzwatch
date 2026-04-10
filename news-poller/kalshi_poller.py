"""
Kalshi prediction market poller — Iran/Hormuz/Persian Gulf contracts.

Source: Kalshi Trade API v2 (public market data, no API key required for reads)
Endpoint: https://api.elections.kalshi.com/trade-api/v2/markets
Produces to Kafka topic: market-ticks

Kalshi markets resolve YES/NO based on real-world events.
Price = probability of YES outcome (0-1), displayed as percentage.
"""
import logging
import re
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
TOPIC = "market-ticks"
POLL_INTERVAL = 5 * 60  # 5 minutes

# Search terms covering Iran conflict + commodity/macro markets
SEARCH_TERMS = [
    "hormuz", "iran", "persian gulf", "strait",
    "oil price", "crude oil", "brent",
    "inflation", "cpi", "recession", "fed rate",
    "middle east", "nuclear",
]

# Keyword filter — whole-word match, Iran/commodities/macro only
RELEVANT_KEYWORDS = [
    "iran", "hormuz", "strait", "persian gulf", "middle east",
    "crude oil", "oil price", "brent", "wti", "opec", "gasoline",
    "inflation", "cpi", "federal reserve", "recession",
    "iran war", "iran attack", "iran nuclear", "nuclear deal",
    "sanctions", "oil embargo", "energy crisis",
    "commodities", "oil barrel",
]

_KW_PATTERNS = [re.compile(r'\b' + re.escape(kw) + r'\b', re.I) for kw in RELEVANT_KEYWORDS]


def is_relevant(market: dict) -> bool:
    text = (
        market.get("title", "") + " " +
        market.get("subtitle", "") + " " +
        market.get("category", "")
    )
    return any(p.search(text) for p in _KW_PATTERNS)


def fetch_markets(term: str) -> list[dict]:
    try:
        resp = requests.get(
            f"{KALSHI_BASE}/markets",
            params={"search": term, "status": "open", "limit": 50},
            headers={"Accept": "application/json"},
            timeout=15,
        )
        if resp.status_code != 200:
            log.debug("Kalshi %s returned %d", term, resp.status_code)
            return []
        data = resp.json()
        return data.get("markets", [])
    except Exception as e:
        log.debug("Kalshi search error for %r: %s", term, e)
        return []


def parse_market(m: dict) -> dict | None:
    try:
        ticker = m.get("ticker", "")
        title = m.get("title", "")
        subtitle = m.get("subtitle", "")

        # yes_bid is the market price for YES (0-99 cents = 0-99% probability)
        yes_bid = m.get("yes_bid")
        yes_ask = m.get("yes_ask")
        last_price = m.get("last_price")

        # Use midpoint or last traded price
        if yes_bid is not None and yes_ask is not None:
            yes_prob = (yes_bid + yes_ask) / 2
        elif last_price is not None:
            yes_prob = last_price
        else:
            return None  # no price data

        # Kalshi prices are in cents (0-99), convert to percentage
        yes_pct = round(yes_prob, 1)

        volume = m.get("volume", 0) or 0
        open_interest = m.get("open_interest", 0) or 0
        close_time = m.get("close_time") or m.get("expiration_time") or ""

        name = f"{title}: {subtitle}" if subtitle else title
        name = name[:80]

        return {
            "symbol": f"KALSHI:{ticker[:20]}",
            "name": name,
            "price": yes_pct,
            "change_pct": 0,
            "volume": volume,
            "open_interest": open_interest,
            "end_date": close_time,
            "active": True,
            "closed": False,
            "question": name,
            "yes_probability": yes_pct,
            "market_type": "prediction",
            "source": "kalshi",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        log.debug("parse_market error: %s — %r", e, m.get("ticker"))
        return None


def run():
    from kafka_utils import make_producer
    producer = make_producer()
    log.info("Kalshi poller started.")

    while True:
        try:
            seen_tickers: set[str] = set()
            sent = 0

            for term in SEARCH_TERMS:
                markets = fetch_markets(term)
                for m in markets:
                    ticker = m.get("ticker", "")
                    if ticker in seen_tickers:
                        continue
                    seen_tickers.add(ticker)

                    if not is_relevant(m):
                        continue
                    parsed = parse_market(m)
                    if parsed:
                        producer.send(TOPIC, parsed)
                        sent += 1
                        log.info(
                            "Kalshi: %s — YES %.1f%% | vol %d",
                            parsed["name"][:55],
                            parsed["yes_probability"],
                            parsed["volume"],
                        )

            if sent == 0:
                log.info("No active Kalshi markets found for search terms.")
            else:
                log.info("Kalshi: published %d markets.", sent)

        except Exception as e:
            log.warning("Kalshi poller error: %s", e)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
