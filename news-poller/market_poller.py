"""Market data poller — commodity + equity prices to Kafka."""
import logging
import time
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

SYMBOLS = [
    {"symbol": "CL=F",  "name": "WTI Crude"},
    {"symbol": "BZ=F",  "name": "Brent Crude"},
    {"symbol": "NG=F",  "name": "Natural Gas"},
    {"symbol": "FRO",   "name": "Frontline"},
    {"symbol": "STNG",  "name": "Scorpio Tankers"},
    {"symbol": "DHT",   "name": "DHT Holdings"},
    {"symbol": "XOM",   "name": "ExxonMobil"},
    {"symbol": "CVX",   "name": "Chevron"},
    {"symbol": "BP",    "name": "BP"},
    {"symbol": "ITA",   "name": "US Aerospace & Defense ETF"},
    {"symbol": "ZIM",   "name": "ZIM Shipping"},
]

TOPIC = "market-ticks"
POLL_INTERVAL = 30
_prev_prices: dict[str, float] = {}


def format_tick(symbol: str, name: str, price: float, prev_price: float) -> dict:
    change_pct = ((price - prev_price) / prev_price * 100) if prev_price else 0.0
    return {
        "symbol": symbol,
        "name": name,
        "price": round(price, 2),
        "change_pct": round(change_pct, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def poll_once(producer):
    import yfinance as yf
    tickers = yf.Tickers(" ".join(s["symbol"] for s in SYMBOLS))
    for item in SYMBOLS:
        sym = item["symbol"]
        try:
            info = tickers.tickers[sym].fast_info
            price = float(info.last_price)
            prev = _prev_prices.get(sym, price)
            tick = format_tick(sym, item["name"], price, prev)
            _prev_prices[sym] = price
            producer.send(TOPIC, tick)
        except Exception as e:
            log.warning(f"Price error {sym}: {e}")


def run():
    from kafka_utils import make_producer
    producer = make_producer()
    log.info("Market poller started.")
    while True:
        poll_once(producer)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
