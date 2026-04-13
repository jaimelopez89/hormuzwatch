"""FastAPI backend — REST endpoints + SSE for HormuzWatch."""
import asyncio
import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import AsyncIterator

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from sse_starlette.sse import EventSourceResponse

from kafka_utils import make_consumer, make_producer
from state import state

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


def _bootstrap_portwatch():
    """Fetch PortWatch data directly on startup — don't wait for Kafka."""
    import requests
    try:
        ARCGIS_URL = (
            "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services"
            "/Daily_Chokepoints_Data/FeatureServer/0/query"
        )
        PARAMS = {
            "where": "portid='chokepoint6'",
            "outFields": "*",
            "orderByFields": "date DESC",
            "resultRecordCount": 365,
            "f": "json",
        }
        resp = requests.get(ARCGIS_URL, params=PARAMS, timeout=20)
        resp.raise_for_status()
        features = resp.json().get("features", [])
        from datetime import datetime, timezone
        records = []
        for feat in features:
            a = feat.get("attributes", {})
            ts_ms = a.get("date")
            date_str = (
                datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                if ts_ms else None
            )
            records.append({
                "date": date_str,
                "n_total": a.get("n_total") or 0,
                "n_tanker": a.get("n_tanker") or 0,
                "n_container": a.get("n_container") or 0,
                "n_dry_bulk": a.get("n_dry_bulk") or 0,
                "n_general_cargo": a.get("n_general_cargo") or 0,
                "n_roro": a.get("n_roro") or 0,
            })
        records.sort(key=lambda r: r["date"] or "")
        recent = [r["n_total"] for r in records[-90:] if r["n_total"] > 0]
        avg_90 = sum(recent) / len(recent) if recent else 0
        latest = records[-1] if records else {}
        pct = round(latest.get("n_total", 0) / avg_90 * 100, 1) if avg_90 else 0
        state.set_portwatch({
            "source": "imf_portwatch",
            "latest_date": latest.get("date"),
            "latest_total": latest.get("n_total", 0),
            "latest_tanker": latest.get("n_tanker", 0),
            "avg_90d": round(avg_90, 1),
            "pct_of_baseline": pct,
            "days": records[-90:],
            "all_days": records,
        })
        log.info(f"PortWatch bootstrapped: {latest.get('date')} — {latest.get('n_total')} vessels ({pct}% of 90d avg {avg_90:.0f})")
        state.touch_source("portwatch")
    except Exception as e:
        log.warning(f"PortWatch bootstrap failed (non-fatal): {e}")


def _risk_history_recorder():
    """Background thread — records risk snapshot every 5 minutes."""
    import time as _time
    while True:
        _time.sleep(300)
        state.record_risk_snapshot()


@asynccontextmanager
async def lifespan(app: FastAPI):
    t = threading.Thread(target=kafka_listener, daemon=True)
    t.start()
    log.info("Kafka listener started.")
    pw_thread = threading.Thread(target=_bootstrap_portwatch, daemon=True)
    pw_thread.start()
    rh_thread = threading.Thread(target=_risk_history_recorder, daemon=True)
    rh_thread.start()
    # Seed first snapshot immediately
    state.record_risk_snapshot()
    yield


app = FastAPI(title="HormuzWatch API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── REST endpoints ──────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/vessels")
def get_vessels(
    min_lat: float = Query(None), max_lat: float = Query(None),
    min_lon: float = Query(None), max_lon: float = Query(None),
):
    return state.get_vessels(min_lat, max_lat, min_lon, max_lon)


@app.get("/api/briefing")
def get_briefing():
    return state.briefing


@app.get("/api/market")
def get_market():
    return state.market


@app.get("/api/risk")
def get_risk():
    return state.get_risk()


@app.get("/api/stats")
def get_stats():
    return state.stats()


@app.get("/api/events")
def get_events(limit: int = 50):
    return list(state.events)[:limit]


@app.get("/api/status")
def get_status():
    """Unified 'Is Hormuz Open?' determination from all signals."""
    return state.get_status()


@app.get("/api/portwatch")
def get_portwatch():
    """IMF PortWatch daily transit data (90 days + all 365 days)."""
    return state.portwatch or {"error": "No PortWatch data yet"}


@app.get("/api/polymarket")
def get_polymarket():
    """Polymarket prediction market odds for Hormuz markets."""
    return list(state.polymarkets.values())


@app.get("/api/risk/history")
def get_risk_history():
    """24h risk score history for sparkline — one point per 5 minutes."""
    return state.get_risk_history()


@app.get("/health/details")
def health_details():
    """Per-source health status for ops dashboard."""
    return state.get_health()


@app.get("/api/polymarket/summary")
def get_polymarket_summary():
    """Best single YES probability across all active Hormuz markets."""
    markets = [m for m in state.polymarkets.values() if m.get("yes_probability") is not None]
    if not markets:
        return {"yes_probability": None, "market": None}
    best = max(markets, key=lambda m: m.get("yes_probability", 0))
    return {"yes_probability": best["yes_probability"], "market": best}


# ── Embed widget endpoint ───────────────────────────────────────────────────

@app.get("/embed", response_class=HTMLResponse)
async def embed_widget():
    """Embeddable status badge — iframe this at width=300, height=100."""
    status = state.get_status()
    is_open = status["is_open"]
    color = {"YES": "#22c55e", "NO": "#ef4444", "UNCERTAIN": "#f59e0b"}.get(is_open, "#64748b")
    label = {"YES": "OPEN", "NO": "DISRUPTED", "UNCERTAIN": "UNCERTAIN"}.get(is_open, "UNKNOWN")
    risk = status["risk_level"]
    vessels = status["active_vessels"]

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: #030810; font-family: 'JetBrains Mono', monospace; overflow: hidden; }}
  .badge {{ display: flex; align-items: center; gap: 12px; padding: 12px 16px;
    border: 1px solid {color}44; border-radius: 8px;
    box-shadow: 0 0 16px {color}22; width: 100%; }}
  .open-label {{ font-size: 9px; letter-spacing: 2px; color: {color}; opacity: 0.7; }}
  .open-val {{ font-size: 28px; font-weight: 700; color: {color}; }}
  .right {{ color: #94a3b8; }}
  .q {{ font-size: 9px; letter-spacing: 1px; color: {color}; font-weight: 700; }}
  .sub {{ font-size: 10px; margin-top: 2px; }}
  a {{ color: #00d4ff; text-decoration: none; font-size: 9px; }}
</style></head>
<body>
<div class="badge">
  <div>
    <div class="open-label">IS HORMUZ OPEN?</div>
    <div class="open-val">{label}</div>
  </div>
  <div class="right">
    <div class="q">RISK: {risk}</div>
    <div class="sub">{vessels} vessels tracked</div>
    <div style="margin-top:4px"><a href="https://hormuzwatch.io" target="_blank">hormuzwatch.io ↗</a></div>
  </div>
</div>
</body></html>"""


# ── SSE endpoints ───────────────────────────────────────────────────────────

@app.get("/stream/vessels")
async def stream_vessels():
    async def gen() -> AsyncIterator[dict]:
        while True:
            vessels = state.get_vessels()
            yield {"data": json.dumps(vessels)}
            await asyncio.sleep(2)
    return EventSourceResponse(gen())


@app.get("/stream/briefing")
async def stream_briefing():
    async def gen() -> AsyncIterator[dict]:
        last = None
        while True:
            if state.briefing != last:
                last = state.briefing
                yield {"data": json.dumps(last)}
            await asyncio.sleep(5)
    return EventSourceResponse(gen())


@app.get("/stream/events")
async def stream_events():
    async def gen() -> AsyncIterator[dict]:
        seen = 0
        while True:
            events = list(state.events)
            new = events[:len(events) - seen]
            for ev in reversed(new):
                yield {"data": json.dumps(ev)}
            seen = len(events)
            await asyncio.sleep(1)
    return EventSourceResponse(gen())


@app.get("/rss", response_class=Response)
async def rss_feed():
    """RSS feed of the latest intelligence events — subscribe in news readers."""
    from feedgen.feed import FeedGenerator
    from datetime import datetime, timezone

    fg = FeedGenerator()
    fg.id("https://hormuzwatch.io/rss")
    fg.title("HormuzWatch Intelligence Feed — Strait of Hormuz")
    fg.author({"name": "HormuzWatch", "email": "intel@hormuzwatch.io"})
    fg.link(href="https://hormuzwatch.io", rel="alternate")
    fg.link(href="https://hormuzwatch.io/rss", rel="self")
    fg.description("Real-time intelligence events from the Strait of Hormuz")
    fg.language("en")
    fg.logo("https://hormuzwatch.io/favicon.ico")

    events = list(state.events)[:50]
    for ev in events:
        fe = fg.add_entry()
        eid = f"hormuzwatch-{ev.get('type','')}-{ev.get('mmsi','')}-{ev.get('timestamp','')}"
        fe.id(eid)
        fe.title(f"[{ev.get('severity','?')}] {ev.get('type','UNKNOWN').replace('_',' ')} — {ev.get('description','')[:80]}")
        fe.description(ev.get("description", ""))
        fe.link(href="https://hormuzwatch.io")
        try:
            ts = datetime.fromisoformat(ev["timestamp"].replace("Z", "+00:00")) if ev.get("timestamp") else datetime.now(timezone.utc)
            fe.pubDate(ts)
        except Exception:
            fe.pubDate(datetime.now(timezone.utc))

    rss = fg.rss_str(pretty=True)
    return Response(content=rss, media_type="application/rss+xml")


@app.get("/stream/status")
async def stream_status():
    """SSE for unified status — updates every 10 seconds."""
    async def gen() -> AsyncIterator[dict]:
        last = None
        while True:
            s = state.get_status()
            if s != last:
                last = s
                yield {"data": json.dumps(s)}
            await asyncio.sleep(10)
    return EventSourceResponse(gen())


# ── Kafka consumer background thread ───────────────────────────────────────

def kafka_listener():
    consumer = make_consumer(
        ["ais-positions", "intelligence-events", "briefings", "market-ticks"],
        "hormuzwatch-backend",
    )
    for msg in consumer:
        topic, value = msg.topic, msg.value
        if topic == "ais-positions":
            state.update_vessel(value)
            state.touch_source(value.get("_source", "aisstream"))
        elif topic == "intelligence-events":
            state.add_event(value)
        elif topic == "briefings":
            state.set_briefing(value)
            state.touch_source("synthesizer")
        elif topic == "market-ticks":
            state.update_market(value)
            src = "prediction_mkts" if value.get("market_type") == "prediction" else "markets"
            state.touch_source(src)
        elif topic == "portwatch-data":
            state.set_portwatch(value)


if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=False)
