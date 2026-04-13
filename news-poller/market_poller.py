"""Market data poller — commodity + equity prices to Kafka.

Uses Yahoo Finance's v7 quote API directly via requests — no yfinance
dependency so there's no websockets version conflict.
"""
import logging
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

SYMBOLS = [
    # Crude oil benchmarks
    {"symbol": "CL=F",  "name": "WTI Crude"},
    {"symbol": "BZ=F",  "name": "Brent Crude"},
    {"symbol": "NG=F",  "name": "Natural Gas"},

    # Tanker pure-plays — most sensitive to Hormuz risk premium
    {"symbol": "FRO",   "name": "Frontline"},
    {"symbol": "STNG",  "name": "Scorpio Tankers"},
    {"symbol": "DHT",   "name": "DHT Holdings"},
    {"symbol": "TK",    "name": "Teekay Corp"},
    {"symbol": "NAT",   "name": "Nordic American Tankers"},

    # Majors
    {"symbol": "XOM",   "name": "ExxonMobil"},
    {"symbol": "CVX",   "name": "Chevron"},
    {"symbol": "BP",    "name": "BP"},
    {"symbol": "SHEL",  "name": "Shell"},
    {"symbol": "TTE",   "name": "TotalEnergies"},

    # Defence
    {"symbol": "ITA",   "name": "US A&D ETF"},
    {"symbol": "LMT",   "name": "Lockheed Martin"},
    {"symbol": "RTX",   "name": "RTX Corp"},

    # Shipping
    {"symbol": "ZIM",   "name": "ZIM Shipping"},
]

TOPIC = "market-ticks"
POLL_INTERVAL = 30
_prev_prices: dict[str, float] = {}

_session = requests.Session()
_session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
})
_crumb: str | None = None


def _init_yahoo() -> str:
    """Initialise Yahoo Finance session cookies and return a fresh crumb token."""
    _session.get("https://finance.yahoo.com", timeout=10)
    resp = _session.get(
        "https://query1.finance.yahoo.com/v1/test/getcrumb", timeout=10
    )
    resp.raise_for_status()
    return resp.text.strip()


def fetch_prices(symbols: list[str]) -> dict[str, float]:
    """Return {symbol: last_price} for all requested symbols."""
    global _crumb
    if not _crumb:
        _crumb = _init_yahoo()

    def _query(crumb: str) -> requests.Response:
        return _session.get(
            "https://query1.finance.yahoo.com/v7/finance/quote",
            params={"symbols": ",".join(symbols), "crumb": crumb},
            timeout=15,
        )

    resp = _query(_crumb)
    if resp.status_code == 401:
        _crumb = _init_yahoo()
        resp = _query(_crumb)
    resp.raise_for_status()

    prices: dict[str, float] = {}
    for q in resp.json().get("quoteResponse", {}).get("result", []):
        sym = q.get("symbol")
        price = q.get("regularMarketPrice")
        if sym and price is not None:
            prices[sym] = float(price)
    return prices


def format_tick(symbol: str, name: str, price: float, prev_price: float) -> dict:
    change_pct = ((price - prev_price) / prev_price * 100) if prev_price else 0.0
    return {
        "symbol": symbol,
        "name": name,
        "price": round(price, 2),
        "change_pct": round(change_pct, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def poll_once(producer) -> int:
    """Fetch prices and publish ticks. Returns number of ticks sent."""
    all_syms = [s["symbol"] for s in SYMBOLS]
    try:
        prices = fetch_prices(all_syms)
    except Exception as e:
        log.warning("Yahoo Finance fetch failed: %s", e)
        return 0

    sent = 0
    for item in SYMBOLS:
        sym = item["symbol"]
        price = prices.get(sym)
        if price is None:
            continue
        prev = _prev_prices.get(sym, price)
        tick = format_tick(sym, item["name"], price, prev)
        _prev_prices[sym] = price
        producer.send(TOPIC, tick)
        sent += 1
    return sent


def run():
    from kafka_utils import make_producer
    producer = make_producer()
    log.info("Market poller started.")
    while True:
        n = poll_once(producer)
        if n:
            log.info("Market: published %d ticks.", n)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
