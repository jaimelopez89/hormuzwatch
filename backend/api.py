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
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from sse_starlette.sse import EventSourceResponse

import replay as _replay
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
    # Weather poller — ECMWF via Open-Meteo, no API key needed
    from weather_poller import run as _run_weather, poll_once as _wx_poll_once
    # Seed in a thread so startup isn't blocked by network I/O
    threading.Thread(target=_wx_poll_once, args=(state,), daemon=True).start()
    threading.Thread(target=_run_weather, args=(state,), daemon=True).start()
    log.info("Weather poller started (ECMWF via Open-Meteo).")

    # Direct data fetchers — bypass Kafka, update state in-process.
    # These are backup threads that ensure data flows even when Kafka is down.
    from data_fetchers import (
        run_market_fetcher, run_polymarket_fetcher,
        run_news_fetcher, run_synthesizer, run_windward_scraper,
        run_portwatch_refresh,
    )
    threading.Thread(target=run_market_fetcher, args=(state,), daemon=True).start()
    threading.Thread(target=run_polymarket_fetcher, args=(state,), daemon=True).start()
    threading.Thread(target=run_news_fetcher, args=(state,), daemon=True).start()
    threading.Thread(target=run_synthesizer, args=(state,), daemon=True).start()
    threading.Thread(target=run_windward_scraper, args=(state,), daemon=True).start()
    threading.Thread(target=run_portwatch_refresh, args=(state,), daemon=True).start()
    log.info("Direct data fetchers started (market, polymarket, news, synthesizer, windward, portwatch).")

    # Seed first snapshot immediately
    state.record_risk_snapshot()
    yield


app = FastAPI(title="HormuzWatch API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── REST endpoints ──────────────────────────────────────────────────────────

@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/ingest/vessels")
async def ingest_vessels(request: Request):
    """Accept vessel positions pushed from external scrapers (GitHub Actions).
    Also forwards to Kafka so Flink can process them.
    Protected by a simple bearer token (INGEST_API_KEY env var)."""
    expected = os.environ.get("INGEST_API_KEY")
    if expected:
        auth = request.headers.get("Authorization", "")
        if auth != f"Bearer {expected}":
            return Response(status_code=403, content="Forbidden")
    body = await request.json()
    vessels = body if isinstance(body, list) else body.get("vessels", [])

    # Try to get a Kafka producer to forward to Flink
    kafka_producer = None
    try:
        kafka_producer = make_producer()
    except Exception:
        pass  # Kafka unavailable — still accept into state

    count = 0
    for v in vessels:
        if v.get("mmsi") and v.get("lat") and v.get("lon"):
            state.update_vessel(v)
            # Forward to Kafka → Flink picks it up for analytics
            if kafka_producer:
                try:
                    kafka_producer.send("ais-positions", v)
                except Exception:
                    pass
            count += 1

    if kafka_producer:
        try:
            kafka_producer.flush(5)
        except Exception:
            pass

    state.touch_source("marinetraffic")
    return {"accepted": count}


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


@app.get("/api/heatmap")
def get_heatmap():
    return state.get_heatmap()


@app.get("/api/predictions")
def get_predictions():
    return state.get_predictions()


@app.get("/api/fleet-graph")
def get_fleet_graph():
    return state.get_fleet_graph()


@app.get("/api/throughput")
def get_throughput():
    return state.get_throughput()


@app.get("/api/weather")
def get_weather():
    """Current maritime weather at the Strait of Hormuz (ECMWF via Open-Meteo)."""
    wx = state.get_weather()
    if wx is None:
        return {"error": "Weather data not yet available"}
    return wx


@app.get("/api/geofences")
def get_geofences():
    return state.get_geofences()


@app.post("/api/geofences")
async def publish_geofence(request: Request):
    """Publish a geofence definition to Kafka so Flink picks it up dynamically."""
    gf = await request.json()
    try:
        from kafka_utils import make_producer
        producer = make_producer()
        producer.send("geofence-control", gf)
        producer.flush()
        producer.close()
    except Exception:
        pass  # continue even if Kafka unavailable
    state.set_geofence(gf)
    return {"status": "published", "id": gf.get("id")}


@app.delete("/api/geofences/{gf_id}")
async def delete_geofence(gf_id: str):
    try:
        from kafka_utils import make_producer
        producer = make_producer()
        producer.send("geofence-control", {"id": gf_id, "active": False})
        producer.flush()
        producer.close()
    except Exception:
        pass
    state.set_geofence({"id": gf_id, "active": False})
    return {"status": "deleted", "id": gf_id}


@app.get("/api/telemetry")
def get_telemetry():
    import time as _t
    now = _t.time()
    with state._lock:
        ev_count = len(state.events)
        vessel_count = len(state.vessels)
        sources = dict(state._source_last_seen)
        heatmap_cells = len(state.heatmap)
        fleet_edges = len(state.fleet_graph)
        predictions_count = len(state.predictions)

    def age(name):
        ts = sources.get(name)
        return round(now - ts) if ts else None

    return {
        "pipeline": {
            "vessels_tracked": vessel_count,
            "events_buffered": ev_count,
            "heatmap_cells": heatmap_cells,
            "fleet_edges": fleet_edges,
            "predictions": predictions_count,
        },
        "sources": {name: {"age_s": age(name)} for name in ["aisstream", "synthesizer", "markets"]},
        "timestamp": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }


@app.get("/api/query")
async def nl_query(question: str = Query(...)):
    """Stream a Claude-generated answer grounded in live Flink-processed state."""
    from nl_query import stream_answer

    async def gen():
        try:
            async for token in stream_answer(question, state):
                yield {"data": json.dumps({"token": token})}
        except Exception as e:
            yield {"data": json.dumps({"error": str(e)})}
        yield {"data": json.dumps({"done": True})}

    return EventSourceResponse(gen())


@app.get("/api/replay/dates")
def replay_dates():
    return {"dates": _replay.list_available_dates()}


@app.post("/api/replay/start")
async def replay_start(date: str = Query(...), speed: float = Query(default=10.0)):
    _replay.stop_replay()
    asyncio.create_task(_replay.run_replay(date, speed, state))
    return {"status": "started", "date": date, "speed_x": speed}


@app.post("/api/replay/stop")
def replay_stop():
    _replay.stop_replay()
    return {"status": "stopped"}


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


@app.get("/stream/briefing-tokens")
async def stream_briefing_tokens():
    """Stream the latest briefing body word-by-word for live display effect."""
    async def gen() -> AsyncIterator[dict]:
        last_seen_ts = None
        while True:
            b = state.briefing
            if b and b.get("generated_at") != last_seen_ts:
                last_seen_ts = b.get("generated_at")
                body = b.get("text") or b.get("body") or ""
                duration_ms = b.get("synthesis_duration_ms", 0)
                yield {"data": json.dumps({
                    "type": "meta",
                    "headline": b.get("headline") or b.get("model") or "Intelligence Briefing",
                    "duration_ms": duration_ms,
                    "generated_at": b.get("generated_at"),
                })}
                words = body.split()
                delay = min(0.08, duration_ms / max(len(words), 1) / 1000)
                for word in words:
                    yield {"data": json.dumps({"type": "token", "token": word + " "})}
                    await asyncio.sleep(delay)
                yield {"data": json.dumps({"type": "done"})}
            await asyncio.sleep(5)
    return EventSourceResponse(gen())


# ── Kafka consumer background thread ───────────────────────────────────────

def _parse_inner(value: dict) -> dict:
    """Flink wraps domain objects as JSON in IntelligenceEvent.description."""
    desc = value.get("description", "")
    if isinstance(desc, str) and desc.startswith("{"):
        try:
            return json.loads(desc)
        except Exception:
            pass
    return value


def kafka_listener():
    consumer = make_consumer(
        ["ais-positions", "intelligence-events", "briefings", "market-ticks"],
        "hormuzwatch-backend",
    )
    for msg in consumer:
        try:
            topic, value = msg.topic, msg.value
            if topic == "ais-positions":
                state.update_vessel(value)
                state.touch_source(value.get("_source", "aisstream"))
                try:
                    from replay import record_position
                    record_position(value)
                except Exception:
                    pass
            elif topic == "intelligence-events":
                ev_type = value.get("type", "")
                if ev_type == "HEATMAP_CELL":
                    state.update_heatmap(_parse_inner(value))
                elif ev_type == "TRAJECTORY_PREDICTION":
                    state.update_prediction(_parse_inner(value))
                elif ev_type == "FLEET_EDGE":
                    state.update_fleet_edge(_parse_inner(value))
                elif ev_type == "THROUGHPUT_SNAPSHOT":
                    state.update_throughput(_parse_inner(value))
                else:
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
        except Exception as exc:
            log.error("kafka_listener: error processing %s message: %s", topic if 'topic' in dir() else "?", exc)


if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=False)
