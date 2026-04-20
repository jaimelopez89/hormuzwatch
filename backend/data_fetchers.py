"""Background data fetchers — bypass Kafka, update state directly.

On Railway, Kafka SSL doesn't work reliably. These threads replicate what
the standalone pollers do (market, polymarket, news, synthesizer) but write
to AppState directly instead of going through Kafka.

PortWatch and Weather already work this way in the lifespan.
"""
import json
import logging
import os
import re
import time
from datetime import datetime, timezone

import requests

log = logging.getLogger(__name__)

# ─── Market data (Yahoo Finance v8 + Stooq fallback) ───────────────────────

MARKET_SYMBOLS = [
    {"symbol": "CL=F",  "name": "WTI Crude",      "stooq": "@cl.f"},
    {"symbol": "BZ=F",  "name": "Brent Crude",     "stooq": "@cb.f"},
    {"symbol": "NG=F",  "name": "Natural Gas",      "stooq": "@ng.f"},
    {"symbol": "FRO",   "name": "Frontline",        "stooq": "fro.us"},
    {"symbol": "STNG",  "name": "Scorpio Tankers",  "stooq": "stng.us"},
    {"symbol": "XOM",   "name": "ExxonMobil",       "stooq": "xom.us"},
    {"symbol": "CVX",   "name": "Chevron",           "stooq": "cvx.us"},
    {"symbol": "BP",    "name": "BP",                "stooq": "bp.us"},
    {"symbol": "SHEL",  "name": "Shell",             "stooq": "shel.us"},
]

_prev_prices: dict[str, float] = {}
_session = requests.Session()
_session.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Referer": "https://finance.yahoo.com/",
})


def _yf_price(symbol: str) -> float | None:
    try:
        r = _session.get(
            f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"range": "1d", "interval": "1m"}, timeout=10,
        )
        if not r.ok:
            return None
        meta = r.json().get("chart", {}).get("result", [{}])[0].get("meta", {})
        p = meta.get("regularMarketPrice")
        return float(p) if p is not None else None
    except Exception:
        return None


def _stooq_price(stooq_sym: str) -> float | None:
    import csv, io
    try:
        r = _session.get(f"https://stooq.com/q/l/?s={stooq_sym}&f=sd2t2ohlcv&h&e=csv", timeout=10)
        if not r.ok:
            return None
        row = next(csv.DictReader(io.StringIO(r.text)), None)
        if row and row.get("Close") not in (None, "N/D", ""):
            return float(row["Close"])
    except Exception:
        pass
    return None


def run_market_fetcher(state):
    """Fetch commodity + equity prices every 3 minutes."""
    log.info("Market fetcher thread started.")
    while True:
        try:
            for item in MARKET_SYMBOLS:
                sym = item["symbol"]
                price = _yf_price(sym) or _stooq_price(item["stooq"])
                if price is None:
                    continue
                prev = _prev_prices.get(sym, price)
                change_pct = ((price - prev) / prev * 100) if prev else 0.0
                _prev_prices[sym] = price
                state.update_market({
                    "symbol": sym,
                    "name": item["name"],
                    "price": round(price, 2),
                    "change_pct": round(change_pct, 2),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                time.sleep(0.15)
            state.touch_source("markets")
        except Exception as e:
            log.warning("Market fetcher error: %s", e)
        time.sleep(180)


# ─── Polymarket ─────────────────────────────────────────────────────────────

GAMMA_BASE = "https://gamma-api.polymarket.com"
SEARCH_TERMS = ["hormuz", "iran war", "oil price", "persian gulf", "middle east war"]
_KW_PATTERNS = [
    re.compile(r'\b' + re.escape(kw) + r'\b', re.I)
    for kw in [
        "iran", "hormuz", "strait", "persian gulf", "middle east",
        "crude oil", "oil price", "brent", "wti", "opec",
        "sanctions", "embargo", "ceasefire",
    ]
]


def run_polymarket_fetcher(state):
    """Fetch prediction market odds every 5 minutes."""
    log.info("Polymarket fetcher thread started.")
    while True:
        try:
            seen = set()
            sent = 0
            for term in SEARCH_TERMS:
                try:
                    r = requests.get(
                        f"{GAMMA_BASE}/markets",
                        params={"search": term, "active": "true", "closed": "false"},
                        timeout=15,
                    )
                    if r.status_code != 200:
                        continue
                    for m in r.json():
                        mid = m.get("id")
                        if mid in seen:
                            continue
                        seen.add(mid)
                        text = m.get("question", "") + " " + m.get("description", "")
                        if not any(p.search(text) for p in _KW_PATTERNS):
                            continue
                        prices_raw = m.get("outcomePrices", "[]")
                        prices = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
                        if not prices:
                            continue
                        yes_prob = round(float(prices[0]) * 100, 1)
                        state.update_market({
                            "symbol": f"POLY:{m.get('slug', mid)[:20]}",
                            "name": m.get("question", "")[:60],
                            "price": yes_prob,
                            "change_pct": 0,
                            "volume": m.get("volumeNum") or 0,
                            "yes_probability": yes_prob,
                            "market_type": "prediction",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })
                        sent += 1
                        log.info("Polymarket: %s — YES %.1f%%", m.get("question", "")[:50], yes_prob)
                except Exception:
                    pass
            if sent:
                state.touch_source("prediction_mkts")
            else:
                log.debug("No active Polymarket markets found.")
        except Exception as e:
            log.warning("Polymarket fetcher error: %s", e)
        time.sleep(300)


# ─── News (RSS feeds) ──────────────────────────────────────────────────────

import feedparser

NEWS_FEEDS = [
    {"url": "https://news.google.com/rss/search?q=strait+of+hormuz&hl=en-US&gl=US&ceid=US:en", "source": "Google News"},
    {"url": "https://warontherocks.com/feed/", "source": "warontherocks"},
    {"url": "https://www.bellingcat.com/feed/", "source": "bellingcat"},
    {"url": "https://www.maritime-executive.com/rss", "source": "maritime-executive"},
]

_seen_news = set()


def run_news_fetcher(state):
    """Fetch news every 15 minutes."""
    log.info("News fetcher thread started.")
    while True:
        try:
            for feed_info in NEWS_FEEDS:
                try:
                    feed = feedparser.parse(feed_info["url"])
                    for entry in feed.entries[:10]:
                        title = entry.get("title", "")
                        link = entry.get("link", "")
                        key = link or title
                        if key in _seen_news:
                            continue
                        _seen_news.add(key)
                        state.add_event({
                            "type": "NEWS",
                            "severity": "LOW",
                            "description": f"[{feed_info['source']}] {title}",
                            "link": link,
                            "timestamp": entry.get("published", datetime.now(timezone.utc).isoformat()),
                            "scoreContribution": 0,
                        })
                except Exception as e:
                    log.debug("Feed %s error: %s", feed_info["source"], e)
            state.touch_source("news")
            # Cap seen set
            if len(_seen_news) > 5000:
                _seen_news.clear()
        except Exception as e:
            log.warning("News fetcher error: %s", e)
        time.sleep(900)


# ─── LLM Synthesizer (briefing generation) ─────────────────────────────────

def run_synthesizer(state):
    """Generate an intelligence briefing every 30 minutes using Claude."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        log.info("Synthesizer: ANTHROPIC_API_KEY not set — skipping.")
        return

    log.info("Synthesizer thread started.")
    while True:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)

            # Gather context
            status = state.get_status()
            events = list(state.events)[:20]
            weather = state.get_weather()

            event_text = "\n".join(
                f"- [{e.get('type')}] {e.get('description', '')[:100]}"
                for e in events[:15]
            ) or "No recent events."

            wx = weather or {}
            wx_str = (
                f"wind {wx.get('wind_kt', 'N/A')} kt, waves {wx.get('wave_m', 'N/A')} m, "
                f"Beaufort {wx.get('beaufort', 'N/A')}"
            ) if weather else "unavailable"

            prompt = f"""You are a maritime intelligence analyst. Generate a concise briefing (3-5 paragraphs) about the current situation at the Strait of Hormuz.

Current data:
- Status: {status.get('is_open')} (confidence: {status.get('confidence')})
- Risk score: {status.get('risk_score')}/100 ({status.get('risk_level')})
- PortWatch transit flow: {status.get('portwatch_pct')}% of baseline
- Active vessels: {status.get('active_vessels')}
- Brent crude: ${status.get('brent_price') or 'N/A'}
- Weather: {wx_str}

Recent events:
{event_text}

Write a professional intelligence briefing. Include risk assessment and outlook."""

            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=800,
                messages=[{"role": "user", "content": prompt}],
            )
            briefing_text = msg.content[0].text

            state.set_briefing({
                "text": briefing_text,
                "risk_score": status.get("risk_score", 50),
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "model": "claude-haiku-4-5-20251001",
            })
            state.touch_source("synthesizer")
            log.info("Synthesizer: briefing generated (%d chars).", len(briefing_text))

        except Exception as e:
            log.warning("Synthesizer error: %s", e)

        time.sleep(1800)


# ─── Windward Insights (scrape crossing data) ──────────────────────────────

def run_windward_scraper(state):
    """Scrape Windward.ai Insights page every 30 minutes."""
    log.info("Windward scraper thread started.")
    while True:
        try:
            resp = requests.get("https://insights.windward.ai/", timeout=30, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            })
            if not resp.ok:
                log.warning("Windward returned %d", resp.status_code)
                time.sleep(1800)
                continue

            html = resp.text
            data = {}

            date_m = re.search(r"Data as of\s+(\w+ \d+,?\s*\d{4})", html)
            if date_m:
                data["data_date"] = date_m.group(1)

            data_arrays = re.findall(r"data:\[([0-9., ]+)\]", html)
            if len(data_arrays) >= 2:
                inb = [float(x.strip()) for x in data_arrays[0].split(",") if x.strip()]
                out = [float(x.strip()) for x in data_arrays[1].split(",") if x.strip()]
                if inb and out:
                    data["latest_crossings"] = inb[-1] + out[-1]

            vessels_m = re.search(r"(\d[,\d]*)\s*Vessels?\s+in\s+(?:the\s+)?Gulf", html, re.I)
            if vessels_m:
                data["vessels_in_gulf"] = int(vessels_m.group(1).replace(",", ""))

            dark_m = re.search(r"(\d[,\d]*)\s*Dark\s+Activity", html, re.I)
            if dark_m:
                data["dark_activity_events"] = int(dark_m.group(1).replace(",", ""))

            if data:
                desc_parts = []
                if "latest_crossings" in data:
                    desc_parts.append(f"Daily crossings: {data['latest_crossings']:.0f}")
                if "vessels_in_gulf" in data:
                    desc_parts.append(f"Vessels in Gulf: {data['vessels_in_gulf']}")
                if "dark_activity_events" in data:
                    desc_parts.append(f"Dark events: {data['dark_activity_events']}")
                state.add_event({
                    "type": "WINDWARD_INSIGHT",
                    "severity": "MEDIUM",
                    "description": " | ".join(desc_parts),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "scoreContribution": 0,
                })
                log.info("Windward: %s", " | ".join(desc_parts))

        except Exception as e:
            log.warning("Windward scraper error: %s", e)

        time.sleep(1800)


# ─── PortWatch periodic refresh ─────────────────────────────────────────────

def run_portwatch_refresh(state):
    """Refresh IMF PortWatch data every 6 hours.

    The lifespan bootstrap fetches once at startup. This thread keeps it fresh.
    """
    log.info("PortWatch refresh thread started (every 6h).")
    time.sleep(21600)  # first refresh after 6h (bootstrap already ran)
    while True:
        try:
            from api import _bootstrap_portwatch
            _bootstrap_portwatch()
        except Exception as e:
            log.warning("PortWatch refresh error: %s", e)
        time.sleep(21600)
