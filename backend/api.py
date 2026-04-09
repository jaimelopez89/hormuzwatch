"""FastAPI backend — REST endpoints + SSE for HormuzWatch."""
import asyncio
import json
import logging
import os
import threading
from typing import AsyncIterator

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from kafka_utils import make_consumer, make_producer
from state import state

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI(title="HormuzWatch API")
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
    return {
        "score": state.risk_score,
        "level": _risk_level(state.risk_score),
    }


@app.get("/api/events")
def get_events(limit: int = 50):
    return list(state.events)[:limit]


def _risk_level(score: int) -> str:
    if score >= 80: return "CRITICAL"
    if score >= 60: return "HIGH"
    if score >= 40: return "ELEVATED"
    return "LOW"


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
        elif topic == "intelligence-events":
            state.add_event(value)
            state.risk_score = min(100, state.risk_score + value.get("scoreContribution", 0))
        elif topic == "briefings":
            state.set_briefing(value)
        elif topic == "market-ticks":
            state.update_market(value)


@app.on_event("startup")
def startup():
    t = threading.Thread(target=kafka_listener, daemon=True)
    t.start()
    log.info("Kafka listener started.")


if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=False)
