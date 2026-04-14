# Backend & AI Services — Next-Gen Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five new backend capabilities: pipeline telemetry endpoint, natural language query via Claude, historical AIS replay service, streaming briefing with latency tracking, and state consumers for the new Flink topics (heatmap, trajectories, fleet graph, throughput, geofences).

**Architecture:** All additions are in the Python `backend/` and `llm-synthesizer/` directories. New Kafka topics (`heatmap-cells`, `vessel-predictions`, `fleet-graph`, `throughput-estimates`, `geofence-control`) are consumed by the existing `kafka_listener` thread in `api.py`. New endpoints are added to `api.py`. `nl_query.py` and `replay.py` are new standalone modules. The synthesizer gains latency tracking and token-streaming via a new SSE endpoint.

**Tech Stack:** FastAPI, kafka-python, anthropic SDK (already in synthesizer venv), Python 3.12, asyncio.

---

## File Structure

**New files:**
- `backend/nl_query.py` — Claude-powered natural language query handler
- `backend/replay.py` — AIS position recorder + replay service

**Modified files:**
- `backend/state.py` — new fields: `heatmap`, `predictions`, `fleet_graph`, `throughput`, `geofences`; new methods for each
- `backend/api.py` — new endpoints + Kafka listener topics + replay/NL routes + geofence publish endpoint
- `llm-synthesizer/synthesizer.py` — add `synthesis_started_at`, `synthesis_duration_ms` to briefing; publish token stream to `briefing-tokens` Kafka topic

---

## Task 1: Extend state.py for new Flink output topics

**Files:**
- Modify: `backend/state.py`

- [ ] **Step 1: Add new state fields to AppState dataclass**

In `backend/state.py`, add these fields to the `AppState` dataclass after `risk_history`:

```python
    # Heatmap cells — cellId → HeatmapCell dict
    heatmap: dict = field(default_factory=dict)

    # Vessel trajectory predictions — mmsi → TrajectoryPrediction dict
    predictions: dict = field(default_factory=dict)

    # Fleet graph edges — "mmsi1:mmsi2" → FleetEdge dict
    fleet_graph: dict = field(default_factory=dict)

    # Throughput snapshots — date → ThroughputSnapshot dict
    throughput: dict = field(default_factory=dict)

    # Analyst-defined geofences — id → GeofenceDefinition dict
    geofences: dict = field(default_factory=dict)
```

- [ ] **Step 2: Add update methods to AppState**

After `get_risk_history`, add:

```python
    def update_heatmap(self, cell: dict):
        with self._lock:
            self.heatmap[cell["cellId"]] = cell

    def update_prediction(self, pred: dict):
        with self._lock:
            self.predictions[str(pred["mmsi"])] = pred

    def update_fleet_edge(self, edge: dict):
        key = f"{edge['sourceMmsi']}:{edge['targetMmsi']}"
        with self._lock:
            existing = self.fleet_graph.get(key, {})
            edge["proximityCount"] = max(edge.get("proximityCount", 1),
                                         existing.get("proximityCount", 0))
            self.fleet_graph[key] = edge

    def update_throughput(self, snap: dict):
        with self._lock:
            self.throughput[snap["date"]] = snap

    def get_heatmap(self) -> list:
        with self._lock:
            return list(self.heatmap.values())

    def get_predictions(self) -> list:
        with self._lock:
            return list(self.predictions.values())

    def get_fleet_graph(self) -> dict:
        """Return {nodes: [...], edges: [...]} for D3 force-directed."""
        with self._lock:
            edges = list(self.fleet_graph.values())
        mmsis = set()
        for e in edges:
            mmsis.add(e["sourceMmsi"])
            mmsis.add(e["targetMmsi"])
        nodes = [{"id": m} for m in mmsis]
        return {"nodes": nodes, "edges": edges}

    def get_throughput(self) -> list:
        with self._lock:
            return sorted(self.throughput.values(), key=lambda x: x.get("date", ""))

    def set_geofence(self, gf: dict):
        with self._lock:
            if gf.get("active", True):
                self.geofences[gf["id"]] = gf
            else:
                self.geofences.pop(gf["id"], None)

    def get_geofences(self) -> list:
        with self._lock:
            return list(self.geofences.values())
```

- [ ] **Step 3: Verify no import errors**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/backend
python3 -c "from state import state; print('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/state.py
git commit -m "feat(backend): extend AppState for heatmap, predictions, fleet-graph, throughput, geofences"
```

---

## Task 2: Wire new Kafka topics into api.py kafka_listener

**Files:**
- Modify: `backend/api.py`

- [ ] **Step 1: Update kafka_listener to consume new topics**

In `backend/api.py`, find the `kafka_listener` function and replace it with:

```python
def kafka_listener():
    consumer = make_consumer(
        [
            "ais-positions", "intelligence-events", "briefings", "market-ticks",
            "heatmap-cells", "vessel-predictions", "fleet-graph",
            "throughput-estimates",
        ],
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
        elif topic == "heatmap-cells":
            state.update_heatmap(value)
        elif topic == "vessel-predictions":
            state.update_prediction(value)
        elif topic == "fleet-graph":
            state.update_fleet_edge(value)
        elif topic == "throughput-estimates":
            state.update_throughput(value)
```

- [ ] **Step 2: Add new REST endpoints to api.py**

After the existing `/api/polymarket/summary` endpoint, add:

```python
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


@app.get("/api/geofences")
def get_geofences():
    return state.get_geofences()


@app.post("/api/geofences")
async def publish_geofence(gf: dict):
    """Publish a geofence definition to Kafka so Flink picks it up dynamically."""
    from kafka_utils import make_producer
    producer = make_producer()
    producer.send("geofence-control", gf)
    producer.flush()
    producer.close()
    state.set_geofence(gf)
    return {"status": "published", "id": gf.get("id")}


@app.delete("/api/geofences/{gf_id}")
async def delete_geofence(gf_id: str):
    from kafka_utils import make_producer
    producer = make_producer()
    producer.send("geofence-control", {"id": gf_id, "active": False})
    producer.flush()
    producer.close()
    state.set_geofence({"id": gf_id, "active": False})
    return {"status": "deleted", "id": gf_id}
```

- [ ] **Step 3: Add telemetry endpoint**

Add after the geofence endpoints:

```python
@app.get("/api/telemetry")
def get_telemetry():
    """
    Pipeline health + throughput metrics exposed to the frontend telemetry panel.
    Kafka consumer lag is approximated from our own state — true lag would require
    KafkaAdminClient which blocks startup; this is a lightweight alternative.
    """
    import time as _t
    now = _t.time()
    with state._lock:
        ev_count = len(state.events)
        vessel_count = sum(1 for v in state.vessels.values()
                          if now - v.get("_ts", 0) < state.VESSEL_TTL)
        sources = dict(state._source_last_seen)

    def age(name):
        ts = sources.get(name)
        return round(now - ts) if ts else None

    return {
        "pipeline": {
            "events_buffered": ev_count,
            "vessels_tracked": vessel_count,
            "heatmap_cells": len(state.heatmap),
            "fleet_edges": len(state.fleet_graph),
            "predictions": len(state.predictions),
        },
        "sources": {
            name: {"age_s": age(name)}
            for name in ["aisstream", "marinetraffic", "portwatch",
                         "news", "markets", "prediction_mkts", "synthesizer"]
        },
        "throughput": state.get_throughput()[-1] if state.throughput else None,
        "timestamp": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    }
```

- [ ] **Step 4: Verify startup**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/backend
python3 -c "import api; print('ok')"
```

Expected: `ok` (may emit Kafka warnings without a broker, but no import errors).

- [ ] **Step 5: Commit**

```bash
git add backend/api.py
git commit -m "feat(backend): new endpoints for heatmap, predictions, fleet-graph, throughput, geofences, telemetry"
```

---

## Task 3: Natural Language Query endpoint (Feature 6)

**Files:**
- Create: `backend/nl_query.py`
- Modify: `backend/api.py`

- [ ] **Step 1: Create nl_query.py**

```python
# backend/nl_query.py
"""Natural language query handler — feeds live state to Claude and streams the answer."""
import json
import os
from typing import AsyncIterator


async def stream_answer(question: str, state) -> AsyncIterator[str]:
    """
    Yield answer tokens one by one as Claude generates them.
    Builds context from the last 50 intelligence events + current market + briefing.
    """
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Build context snapshot
    events = list(state.events)[:50]
    briefing = state.briefing or {}
    market_snapshot = {
        sym: {"price": t.get("price"), "change_pct": t.get("change_pct")}
        for sym, t in list(state.market.items())[:10]
    }
    throughput = state.get_throughput()

    context = (
        "You are a maritime intelligence analyst monitoring the Strait of Hormuz in real time.\n"
        "Your data is sourced from live AIS vessel tracking, satellite imagery, news feeds, "
        "and commodity markets, all processed by Apache Flink on Ververica Cloud.\n\n"
        f"CURRENT SITUATION (as of now):\n"
        f"- Active vessels tracked: {len(state.vessels)}\n"
        f"- Risk score: {state.risk_score}/100\n"
        f"- Latest briefing headline: {briefing.get('headline', 'None yet')}\n\n"
        f"RECENT INTELLIGENCE EVENTS (newest first):\n"
    )
    for ev in events[:20]:
        context += f"  [{ev.get('severity','?')}] {ev.get('type','?')} — {ev.get('description','')}\n"

    context += f"\nMARKET SNAPSHOT:\n"
    for sym, d in market_snapshot.items():
        context += f"  {sym}: ${d['price']} ({d['change_pct']:+.1f}%)\n" if d['price'] else ""

    if throughput:
        latest = throughput[-1]
        context += (f"\nTHROUGHPUT (today): {latest.get('tankerCount',0)} tankers, "
                    f"~{latest.get('estimatedBarrelsMb',0) * 0.5:.1f} Mb/day estimated\n")

    context += f"\nANALYST QUESTION: {question}\n"

    async with client.messages.stream(
        model="claude-opus-4-6",
        max_tokens=800,
        messages=[{"role": "user", "content": context}],
    ) as stream:
        async for text in stream.text_stream:
            yield text
```

- [ ] **Step 2: Add /api/query SSE endpoint to api.py**

Add this import at the top of `backend/api.py` (with existing imports):

```python
from nl_query import stream_answer
```

Then add the endpoint after the telemetry endpoint:

```python
@app.get("/api/query")
async def nl_query(q: str = Query(..., description="Natural language question about Hormuz")):
    """Stream a Claude-generated answer grounded in live Flink-processed state."""
    async def gen() -> AsyncIterator[dict]:
        try:
            async for token in stream_answer(q, state):
                yield {"data": json.dumps({"token": token})}
        except Exception as e:
            yield {"data": json.dumps({"error": str(e)})}
        yield {"data": json.dumps({"done": True})}
    return EventSourceResponse(gen())
```

- [ ] **Step 3: Verify**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/backend
python3 -c "from nl_query import stream_answer; print('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/nl_query.py backend/api.py
git commit -m "feat(backend): /api/query — Claude NL query streamed over SSE with live Flink state context"
```

---

## Task 4: Historical AIS Replay service (Feature 8)

**Files:**
- Create: `backend/replay.py`
- Modify: `backend/api.py`

The replay service records AIS positions to a rolling JSONL file (7-day window, one file per day). A replay session reads a chosen date's file and injects positions into the in-memory state at an adjustable speed multiplier.

- [ ] **Step 1: Create replay.py**

```python
# backend/replay.py
"""
AIS position recorder + replay service.

Recording: appends every ais-position message to
  /tmp/hormuzwatch-replay/YYYY-MM-DD.jsonl

Replay: reads a date file and feeds positions into state at speed_x rate.
        Does NOT publish to Kafka — directly calls state.update_vessel()
        so the map updates without needing a live broker.
"""
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

REPLAY_DIR = Path(os.environ.get("REPLAY_DIR", "/tmp/hormuzwatch-replay"))
REPLAY_DIR.mkdir(parents=True, exist_ok=True)

_replay_task: asyncio.Task | None = None
_replay_active = False


def record_position(pos: dict):
    """Append a vessel position to today's JSONL file. Called from kafka_listener."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = REPLAY_DIR / f"{today}.jsonl"
    try:
        with open(path, "a") as f:
            f.write(json.dumps(pos) + "\n")
    except Exception as e:
        log.debug("replay record error: %s", e)


def list_available_dates() -> list[str]:
    """Return sorted list of dates that have replay data."""
    return sorted(p.stem for p in REPLAY_DIR.glob("*.jsonl"))


async def run_replay(date: str, speed_x: float, state):
    """
    Replay a recorded day. speed_x=1.0 means real-time, 10.0 means 10× faster.
    Reads timestamps from the JSONL and sleeps proportionally between messages.
    """
    global _replay_active
    path = REPLAY_DIR / f"{date}.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"No replay data for {date}")

    _replay_active = True
    log.info("Replay started: %s at %.1fx speed", date, speed_x)

    prev_ts: float | None = None
    with open(path) as f:
        for line in f:
            if not _replay_active:
                break
            try:
                pos = json.loads(line.strip())
            except Exception:
                continue

            # Extract timestamp for pacing
            ts_str = pos.get("timestamp") or pos.get("_ts_iso")
            if ts_str and prev_ts is not None:
                try:
                    curr_ts = datetime.fromisoformat(
                        ts_str.replace("Z", "+00:00")).timestamp()
                    gap = (curr_ts - prev_ts) / speed_x
                    if 0 < gap < 30:   # skip huge gaps (idle periods)
                        await asyncio.sleep(gap)
                    prev_ts = curr_ts
                except Exception:
                    pass
            elif ts_str and prev_ts is None:
                try:
                    prev_ts = datetime.fromisoformat(
                        ts_str.replace("Z", "+00:00")).timestamp()
                except Exception:
                    pass

            pos["_replay"] = True
            state.update_vessel(pos)

    _replay_active = False
    log.info("Replay finished: %s", date)


def stop_replay():
    global _replay_active
    _replay_active = False
```

- [ ] **Step 2: Add replay recording to kafka_listener in api.py**

In the `kafka_listener` function in `backend/api.py`, add a recording call inside the `ais-positions` branch:

```python
        if topic == "ais-positions":
            state.update_vessel(value)
            state.touch_source(value.get("_source", "aisstream"))
            # Record for replay
            from replay import record_position
            record_position(value)
```

- [ ] **Step 3: Add replay endpoints to api.py**

Add at the top of `backend/api.py` with other imports:

```python
import replay as _replay
```

Then add these endpoints after the `/api/query` endpoint:

```python
@app.get("/api/replay/dates")
def replay_dates():
    """List dates that have recorded AIS data for replay."""
    return {"dates": _replay.list_available_dates()}


@app.post("/api/replay/start")
async def replay_start(date: str = Query(...), speed: float = Query(default=10.0)):
    """Start replaying a recorded day at the given speed multiplier."""
    global _replay_task
    _replay.stop_replay()
    if _replay_task and not _replay_task.done():
        _replay_task.cancel()
    _replay_task = asyncio.create_task(
        _replay.run_replay(date, speed, state)
    )
    return {"status": "started", "date": date, "speed_x": speed}


@app.post("/api/replay/stop")
def replay_stop():
    """Stop an in-progress replay."""
    _replay.stop_replay()
    return {"status": "stopped"}


@app.get("/api/replay/status")
def replay_status():
    return {
        "active": _replay._replay_active,
        "available_dates": _replay.list_available_dates(),
    }
```

- [ ] **Step 4: Verify**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/backend
python3 -c "import replay; print(replay.list_available_dates())"
```

Expected: `[]` (no data yet, but no errors).

- [ ] **Step 5: Commit**

```bash
git add backend/replay.py backend/api.py
git commit -m "feat(backend): AIS replay recorder + /api/replay/* endpoints for historical playback"
```

---

## Task 5: Streaming briefing with latency tracking (Feature 9)

**Files:**
- Modify: `llm-synthesizer/synthesizer.py`
- Modify: `backend/api.py`

Add `synthesis_duration_ms` and `synthesis_started_at` to every briefing dict. Add a `/stream/briefing-tokens` SSE endpoint that serves the synthesizer's token stream in real time.

- [ ] **Step 1: Modify synthesizer.py to track latency**

Read `llm-synthesizer/synthesizer.py` to find where `call_claude` is defined and where it publishes to Kafka. Then wrap the Claude call with timing:

Find the section that calls the Claude API and builds the briefing dict. It will look something like:

```python
response = client.messages.create(...)
```

Replace the call block with a timed version. The exact changes depend on the current code, but the pattern is:

```python
import time as _time

# Before the API call:
t0 = _time.time()

# existing: response = client.messages.create(...)

# After getting the response:
duration_ms = round((_time.time() - t0) * 1000)

# Then add to the briefing dict before publishing:
briefing["synthesis_duration_ms"] = duration_ms
briefing["synthesis_started_at"] = datetime.now(timezone.utc).isoformat()
```

To find the exact location, run:

```bash
grep -n "messages.create\|call_claude\|briefing\[" /Users/Jaime/claude-work/hormuzwatch/llm-synthesizer/synthesizer.py | head -30
```

Then make the edit.

- [ ] **Step 2: Add token-streaming endpoint to api.py**

The synthesizer already publishes complete briefings. For token streaming, add a simple SSE that re-emits the latest briefing word by word (simulating stream for demo purposes — true token streaming would require the synthesizer to publish each token to Kafka which adds complexity):

```python
@app.get("/stream/briefing-tokens")
async def stream_briefing_tokens():
    """Stream the latest briefing body word-by-word for live display effect."""
    async def gen() -> AsyncIterator[dict]:
        last_seen_ts = None
        while True:
            b = state.briefing
            if b and b.get("generated_at") != last_seen_ts:
                last_seen_ts = b.get("generated_at")
                body = b.get("body", "")
                duration_ms = b.get("synthesis_duration_ms", 0)
                yield {"data": json.dumps({
                    "type": "meta",
                    "headline": b.get("headline"),
                    "duration_ms": duration_ms,
                    "generated_at": b.get("generated_at"),
                })}
                # Emit words with pacing proportional to synthesis time
                words = body.split()
                delay = min(0.08, duration_ms / max(len(words), 1) / 1000)
                for word in words:
                    yield {"data": json.dumps({"type": "token", "token": word + " "})}
                    await asyncio.sleep(delay)
                yield {"data": json.dumps({"type": "done"})}
            await asyncio.sleep(5)
    return EventSourceResponse(gen())
```

- [ ] **Step 3: Verify synthesizer still runs**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/llm-synthesizer
python3 -c "import synthesizer; print('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add llm-synthesizer/synthesizer.py backend/api.py
git commit -m "feat(backend): briefing latency tracking + /stream/briefing-tokens SSE word-by-word stream"
```

---

*End of Plan B — Backend & AI Services*
