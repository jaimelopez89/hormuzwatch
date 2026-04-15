"""Market data poller — commodity + equity prices to Kafka.

Sources
-------
1. Yahoo Finance v8 chart API  — no crumb/cookie auth, single-symbol calls,
   returns regularMarketPrice (15-min delayed during market hours).
2. Stooq CSV API               — zero auth, reliable fallback, daily close.

Poll interval: 3 minutes — respectful of free-tier rate limits and sufficient
for a maritime intelligence dashboard (oil prices move on news, not seconds).
"""
import csv
import io
import logging
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Symbol table
# ---------------------------------------------------------------------------
SYMBOLS = [
    # Crude oil benchmarks — most important for Hormuz risk premium
    {"symbol": "CL=F",  "name": "WTI Crude",      "stooq": "@cl.f"},
    {"symbol": "BZ=F",  "name": "Brent Crude",     "stooq": "@cb.f"},
    {"symbol": "NG=F",  "name": "Natural Gas",      "stooq": "@ng.f"},

    # Tanker pure-plays — highly sensitive to Hormuz disruption
    {"symbol": "FRO",   "name": "Frontline",        "stooq": "fro.us"},
    {"symbol": "STNG",  "name": "Scorpio Tankers",  "stooq": "stng.us"},
    {"symbol": "DHT",   "name": "DHT Holdings",     "stooq": "dht.us"},
    {"symbol": "TK",    "name": "Teekay Corp",      "stooq": "tk.us"},
    {"symbol": "NAT",   "name": "Nordic American",  "stooq": "nat.us"},

    # Oil majors
    {"symbol": "XOM",   "name": "ExxonMobil",       "stooq": "xom.us"},
    {"symbol": "CVX",   "name": "Chevron",           "stooq": "cvx.us"},
    {"symbol": "BP",    "name": "BP",                "stooq": "bp.us"},
    {"symbol": "SHEL",  "name": "Shell",             "stooq": "shel.us"},
    {"symbol": "TTE",   "name": "TotalEnergies",     "stooq": "tte.us"},

    # Defence
    {"symbol": "LMT",   "name": "Lockheed Martin",  "stooq": "lmt.us"},
    {"symbol": "RTX",   "name": "RTX Corp",          "stooq": "rtx.us"},
    {"symbol": "ITA",   "name": "US A&D ETF",        "stooq": "ita.us"},

    # Shipping
    {"symbol": "ZIM",   "name": "ZIM Shipping",      "stooq": "zim.us"},
]

TOPIC = "market-ticks"
POLL_INTERVAL = 180   # 3 minutes — Yahoo Finance is not a real-time service

_prev_prices: dict[str, float] = {}

_session = requests.Session()
_session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
})


# ---------------------------------------------------------------------------
# Source 1: Yahoo Finance v8 chart  (no crumb/cookie required)
# ---------------------------------------------------------------------------

def _yf_v8_price(symbol: str) -> float | None:
    """Fetch latest price via Yahoo Finance v8 chart endpoint.
    Returns None on any failure — caller falls through to Stooq.
    """
    try:
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
        resp = _session.get(url, params={"range": "1d", "interval": "1m"}, timeout=10)
        if resp.status_code == 429:
            log.debug("Yahoo Finance rate-limited for %s — will use Stooq fallback", symbol)
            return None
        if not resp.ok:
            log.debug("Yahoo Finance v8 returned %d for %s", resp.status_code, symbol)
            return None
        data = resp.json()
        meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})
        price = meta.get("regularMarketPrice")
        return float(price) if price is not None else None
    except Exception as e:
        log.debug("Yahoo Finance v8 error for %s: %s", symbol, e)
        return None


# ---------------------------------------------------------------------------
# Source 2: Stooq CSV  (no API key, daily close)
# ---------------------------------------------------------------------------

def _stooq_price(stooq_sym: str) -> float | None:
    """Fetch latest daily close via Stooq's CSV API."""
    try:
        url = f"https://stooq.com/q/l/?s={stooq_sym}&f=sd2t2ohlcv&h&e=csv"
        resp = _session.get(url, timeout=10)
        if not resp.ok:
            return None
        reader = csv.DictReader(io.StringIO(resp.text))
        row = next(reader, None)
        if row is None:
            return None
        close = row.get("Close") or row.get("close")
        if close and close not in ("N/D", ""):
            return float(close)
        return None
    except Exception as e:
        log.debug("Stooq error for %s: %s", stooq_sym, e)
        return None


# ---------------------------------------------------------------------------
# Poller
# ---------------------------------------------------------------------------

def fetch_all() -> dict[str, float]:
    """Return {yf_symbol: price} for all symbols, trying YF v8 then Stooq."""
    results: dict[str, float] = {}
    yf_hits = 0
    stooq_hits = 0

    for item in SYMBOLS:
        sym = item["symbol"]

        price = _yf_v8_price(sym)
        if price is not None:
            results[sym] = price
            yf_hits += 1
            time.sleep(0.15)   # gentle pacing — ~6 req/s max
            continue

        # Yahoo failed — try Stooq
        price = _stooq_price(item["stooq"])
        if price is not None:
            results[sym] = price
            stooq_hits += 1
        time.sleep(0.1)

    log.debug("Prices: %d from Yahoo v8, %d from Stooq, %d missing",
              yf_hits, stooq_hits, len(SYMBOLS) - len(results))
    return results


def poll_once(producer) -> int:
    prices = fetch_all()
    if not prices:
        log.warning("Market poller: no prices fetched this cycle")
        return 0

    sent = 0
    for item in SYMBOLS:
        sym = item["symbol"]
        price = prices.get(sym)
        if price is None:
            continue
        prev = _prev_prices.get(sym, price)
        change_pct = ((price - prev) / prev * 100) if prev else 0.0
        tick = {
            "symbol": sym,
            "name": item["name"],
            "price": round(price, 2),
            "change_pct": round(change_pct, 2),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        _prev_prices[sym] = price
        producer.send(TOPIC, tick)
        sent += 1
    return sent


def run():
    from kafka_utils import make_producer
    producer = make_producer()
    log.info("Market poller started (interval=%ds, sources: Yahoo v8 + Stooq fallback).",
             POLL_INTERVAL)
    while True:
        n = poll_once(producer)
        if n:
            log.info("Market: published %d ticks.", n)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
