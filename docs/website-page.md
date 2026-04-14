# HormuzWatch — Website Page Brief

> **For Claude Code:** This document is a complete brief for building a project page at `lopez.fi/projects/hormuzwatch`.
> It contains all copy, architecture descriptions, feature lists, tech stack details, and visual guidance needed to build the page.
> The site uses the existing `lopez.fi` design system. Match that aesthetic — clean, technical, professional.

---

## Page metadata

- **Route:** `/projects/hormuzwatch`
- **Title tag:** `HormuzWatch — Real-Time AI Maritime Intelligence | Jaime Lopez`
- **Description:** Open-source maritime intelligence platform monitoring the Strait of Hormuz with Apache Flink, Claude AI, and real-time vessel tracking.

---

## Hero section

**Headline:**
> The world's oil chokepoint, watched in real time by AI.

**Subheadline:**
> HormuzWatch tracks every vessel, news headline, and market signal at the Strait of Hormuz — and runs them through a live Apache Flink + Claude AI pipeline that generates intelligence briefings, trajectory forecasts, risk heatmaps, and strait throughput estimates updated in seconds.

**Two CTAs:**
- `View Live Dashboard →` (primary) — links to `https://hormuzwatch.lopez.fi`
- `View Source on GitHub` (secondary) — links to GitHub repo

**Hero visual:** A dark screenshot of the map view — vessels as orange/red glowing dots on deep navy water, cyan tanker lane overlays, the risk heatmap shimmering in red over the strait mouth. Optionally animated GIF showing vessels moving.

---

## Context: Why the Strait of Hormuz

The Strait of Hormuz is a 33km-wide chokepoint between Iran and Oman through which roughly **20% of the world's daily oil supply** transits. Any disruption — an Iranian vessel seizure, a naval confrontation, a closure threat — sends commodity markets moving within hours.

In periods of elevated tension (US–Iran sanctions, Israeli strikes, Houthi operations in adjacent waters), understanding what is physically happening in the strait — in real time, not via delayed news reports — is directly relevant to:
- **Energy traders** tracking Brent/WTI spreads
- **Shipping analysts** monitoring tanker utilisation and re-routing
- **Geopolitical researchers** connecting maritime patterns to diplomatic signals
- **Anyone who wants to understand how a 33km waterway shapes the global economy**

HormuzWatch was built to make this connection visible and legible, in real time.

---

## What was built

HormuzWatch is two things:

**1. A streaming data pipeline** — AIS vessel transponder data, news RSS feeds, commodity prices, and prediction market odds all flow into Apache Kafka, get processed by Apache Flink stream processors on Ververica Cloud, and are synthesised by Claude into live intelligence.

**2. A monitoring dashboard** — A React single-page application with a Mapbox GL map, live intelligence feed, market panels, and an ANALYTICS tab with ten next-generation AI-powered visualisations built in the second major development sprint (the Intelligence Overhaul).

---

## Feature breakdown

### Original capabilities

These features form the foundation of the platform:

**Live AIS vessel tracking**
Hundreds of vessels tracked in real time from AISStream.io WebSocket + MarineTraffic scraping + AISHub REST API. Ships are rendered as directional icons colour-coded by type: orange tankers, red military, purple cargo, cyan LNG, glowing red sanctioned vessels. Historical trail lines show the last 12 position updates. Mouseover shows MMSI, speed, flag, and nav status. Click opens a detail panel.

**Sanctioned vessel detection**
A hardcoded set of IMO-sanctioned MMSIs (Iranian Revolutionary Guard vessels, shadow fleet tankers) is matched against live AIS data. Sanctioned vessels glow red on the map and generate immediate CRITICAL intelligence events.

**Flink anomaly detectors (original six)**
Six KeyedProcessFunction detectors run continuously on the AIS stream:
- *Traffic Volume Anomaly* — unusual drops or surges vs. 30-day baseline
- *Military Proximity* — warships closing within 5nm of tanker lanes
- *Tanker Concentration* — vessels clustering, suggesting avoidance behaviour
- *Dark AIS Events* — transponders switched off inside the strait corridor
- *Slowdown Detection* — tankers decelerating abruptly in sensitive areas
- *News × AIS Correlation* — simultaneous news escalation and maritime anomaly

**AI situation reports (tiered)**
An LLM synthesis layer consumes intelligence events and generates plain-language briefings using Claude. A four-layer cost control system (significance scoring, delta-based triggering, Haiku/Sonnet model tiering, 2-minute minimum interval) keeps daily API costs at $0.02–$0.15 while briefings update within two minutes of any meaningful event. Each briefing cites historical precedents (2019 tanker attacks, 2012 sanctions, 2011 closure threat) for market context.

**Market signals**
Live prices via Yahoo Finance every 30 seconds: WTI/Brent crude, natural gas, LNG futures; tanker stocks (Frontline, Scorpio, DHT Holdings); energy majors (Exxon, Chevron, BP); Polymarket and Kalshi prediction market odds on Iranian military action.

**Intelligence feed + RSS**
A live scrolling feed of all intelligence events with severity badges. A public `/rss` endpoint lets anyone subscribe to the feed in any RSS reader. An `/embed` widget lets other sites embed the live risk indicator.

---

### Intelligence Overhaul — 10 new next-generation features

The second major sprint added ten new capabilities built on Flink 1.18.1 on Ververica Cloud, new FastAPI endpoints, and nine new React components.

---

#### 1. Multi-signal CEP correlator
**What:** Apache Flink CEP (Complex Event Processing) pattern that detects when two or more independent detectors fire within the same 30-minute window. A single anomaly could be noise; two simultaneous ones almost never are.

**How:** `Pattern.begin("first").followedBy("second").within(Time.minutes(30))` over the intelligence event stream, keyed by grid sector. When the pattern fires, a CRITICAL `MULTI_SIGNAL_CORRELATED` event is emitted with a +35 risk score contribution.

**Why it matters:** Eliminates false positives from individual sensor noise. The Iran "maximum pressure" periods of 2019–2020 were characterised by exactly this pattern: dark AIS events *and* military proximity *and* news escalation happening together.

---

#### 2. Risk heatmap
**What:** A Mapbox fill layer showing risk intensity per 0.2° geographic grid cell, shading from transparent green (quiet) through amber to glowing red (critical). Refreshes every 30 seconds.

**How:** A 5-minute tumbling window `AggregateFunction` in Flink aggregates all intelligence events by grid cell key (`Math.floor(lat * 5) / 5`), computes a weighted risk score, and publishes `HeatmapCell` objects to the `heatmap-cells` Kafka topic. The React `HeatmapLayer` component (logic-only, returns null) manages the Mapbox source/layer lifecycle.

**Why it matters:** Makes geographic risk concentration immediately visible. During chokepoint events, risk doesn't distribute evenly — it concentrates at the strait mouth near Qeshm Island.

---

#### 3. Trajectory prediction (dead-reckoning)
**What:** Dashed purple lines extending from each moving vessel showing its predicted position at 15, 30, 45, 60, 90, and 120 minutes. Refreshes every 60 seconds.

**How:** A Flink `MapFunction` filters vessels with speed ≥ 1.0 kt and valid course (0°–360°), then runs haversine projection for each time horizon: `Δlat = (speed_ms * cos(course_rad) * minutes * 60) / EARTH_RADIUS_M * (180/π)`. Published to `vessel-predictions` topic. The `TrajectoryLayer` React component converts `[[lat, lon, minutesAhead]]` arrays to GeoJSON LineStrings.

**Why it matters:** Analysts can see whether a vessel heading for an Iranian port will arrive before or after a sanctions deadline, or whether a military vessel's course intersects tanker lanes.

---

#### 4. Fleet proximity graph
**What:** A D3 v7 force-directed graph in the ANALYTICS tab showing which vessels are operating in close proximity (within 0.2° / ~22km). Nodes are vessels; edge thickness represents how many times two vessels have been detected near each other.

**How:** A Flink `KeyedProcessFunction` keyed by 0.2° grid sector maintains a `MapState<Long, VesselPosition>` of all vessels in each sector. When a vessel enters a sector, it checks proximity against all existing residents and emits `FleetEdge` records. A 30-minute eviction timer cleans up departed vessels. D3 `forceSimulation` renders the graph with draggable nodes.

**Why it matters:** Reveals rendezvous patterns — STS (ship-to-ship) transfers that bypass port sanctions typically show as two vessels with unusually high proximity counts at the same coordinates.

---

#### 5. Strait throughput estimator
**What:** A bar chart showing estimated barrels-per-day transiting the strait, updated in real time. Displayed as: `14.00M bbl/day · 14 tankers · 14 westbound`.

**How:** A Flink `KeyedProcessFunction` detects westbound crossings of the 58°E meridian within the lat 22°–27°N band (the strait). Only ship types 80–89 (tankers) count. Each tanker is assigned 1,000,000 barrels/day, consistent with VLCC/Suezmax capacity. Daily counts accumulate in `MapState<String, long[]>` and publish `ThroughputSnapshot` records to `throughput-estimates`.

**Why it matters:** Makes the "20% of world oil supply" figure concrete and live. A drop from 14 to 4 westbound tankers per day is an early warning signal days before it shows up in weekly EIA inventory data.

---

#### 6. Natural language intelligence query
**What:** A chat panel in the ANALYTICS tab. Type a plain-English question; Claude answers in real time, grounded in live Flink-processed state. Token-by-token streaming with a blinking cursor.

**How:** `GET /api/query?q=...` opens a Server-Sent Events stream. The backend builds a context string from the current vessel count, risk score, last 20 intelligence events, and latest market prices, then calls `anthropic.AsyncAnthropic` with `client.messages.stream()` and yields each token from `stream.text_stream`. The `NLQueryPanel` React component parses `JSON.parse(ev.data).token` from the SSE stream.

**Example queries:**
- *"Which vessels near Fujairah should I be watching?"*
- *"What does the current tanker clustering pattern suggest?"*
- *"How does today's risk score compare to the 2019 tanker attacks?"*

---

#### 7. Streaming AI briefing
**What:** A live panel in the ANALYTICS tab that displays the current AI briefing being generated word-by-word, with the synthesis latency (e.g. `generation: 4,230ms`) shown below.

**How:** The LLM synthesizer now records `synthesis_started_at` before the Claude API call and `synthesis_duration_ms` after, adding both to the published briefing. The `GET /stream/briefing-tokens` SSE endpoint polls for new briefings every 5 seconds and re-emits the body word-by-word, pacing the delay proportionally to the synthesis time. The `StreamingBriefing` React component parses `{"type":"meta"}` / `{"type":"token"}` / `{"type":"done"}` messages.

---

#### 8. Historical AIS replay
**What:** A date picker + speed multiplier (1×, 5×, 10×, 20×) that replays recorded vessel positions from any previous day, updating the live map as if it were happening now.

**How:** `backend/replay.py` records every AIS position to a daily JSONL file at `/tmp/hormuzwatch-replay/YYYY-MM-DD.jsonl`. On replay start, `asyncio.create_task` runs `run_replay()`, which reads the file and calls `state.update_vessel(pos)` directly (no Kafka required), sleeping between messages proportionally to the original timestamp gaps divided by the speed multiplier. The `ReplayControls` React component calls `POST /api/replay/start?date=...&speed=...`.

**Why it matters:** Lets analysts replay the exact vessel movements from a past incident — the 2024 Houthi escalation, a vessel seizure — and correlate them with what was happening in markets at that moment.

---

#### 9. Analyst geofence studio
**What:** A floating panel on the map (bottom-right) with a polygon drawing tool. Draw any area on the map; it becomes a live monitoring zone. Vessels entering the zone trigger GEOFENCE_BREACH intelligence events. Zones persist across sessions via the API.

**How:** `@mapbox/mapbox-gl-draw` adds the polygon drawing control. On `draw.create`, the frontend POSTs the GeoJSON geometry to `POST /api/geofences`, which publishes it to the `geofence-control` Kafka topic. The Flink `DynamicGeofenceFilter` uses BroadcastProcessFunction to receive geofence updates (broadcast state), then uses JTS (`locationtech/jts-core`) `Polygon.contains(Point)` for O(1) containment testing on every AIS position.

**Why it matters:** Analysts can draw a monitoring box around any suspicious anchorage, STS transfer zone, or military area and immediately start receiving alerts without any code changes.

---

#### 10. Pipeline telemetry panel
**What:** A real-time metrics grid showing the health of the entire data pipeline: vessels tracked, events buffered, heatmap cells active, fleet edges, trajectory forecasts, and AIS data staleness in seconds.

**How:** `GET /api/telemetry` returns a snapshot built from the in-memory `AppState` — no Kafka admin client, no blocking calls. Refreshes every 10 seconds. The `TelemetryPanel` React component displays a 6-metric grid using monospace values styled to match the ops-center aesthetic.

---

## Architecture diagram

```
                         ┌─────────────────────────────────────────────────────────────┐
                         │                   INGEST LAYER                              │
  AISStream.io  ─────────►  ais_connector.py                                           │
  MarineTraffic ─────────►  marinetraffic_scraper.py    ──────► Kafka (Aiven)          │
  AISHub        ─────────►  aishub_poller.py                     ais-positions         │
  Reuters/AP    ─────────►  news_poller.py               ──────► intelligence-events   │
  Yahoo Finance ─────────►  market_poller.py             ──────► market-ticks          │
  IMF PortWatch ─────────►  portwatch_poller.py          ──────► portwatch-data        │
  Polymarket    ─────────►  polymarket_poller.py         ──────► prediction-markets    │
  Kalshi        ─────────►  kalshi_poller.py                                           │
                         └─────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
                         ┌─────────────────────────────────────────────────────────────┐
                         │         STREAM PROCESSING (Apache Flink on Ververica Cloud)  │
                         │                                                             │
                         │  Original detectors:                                        │
                         │  DarkAISDetector · MilitaryProximityDetector               │
                         │  TrafficVolumeDetector · SlowdownDetector                  │
                         │  TankerConcentrationDetector · NewsAISCorrelator           │
                         │                                                             │
                         │  New detectors (Intelligence Overhaul):                    │
                         │  MultiSignalCorrelator (CEP)                               │
                         │  RiskHeatmapAggregator (5-min tumbling window)            │
                         │  TrajectoryPredictor (haversine dead-reckoning)           │
                         │  FleetGraphAggregator (proximity MapState)                │
                         │  ThroughputEstimator (58°E crossing counter)              │
                         │  DynamicGeofenceFilter (broadcast state + JTS)            │
                         │                                                             │
                         │  Output topics:                                             │
                         │  intelligence-events · heatmap-cells · vessel-predictions  │
                         │  fleet-graph · throughput-estimates · briefings            │
                         └─────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
                         ┌─────────────────────────────────────────────────────────────┐
                         │              AI SYNTHESIS LAYER                             │
                         │                                                             │
                         │  synthesizer.py → Claude (Haiku/Sonnet tiered)            │
                         │  nl_query.py   → Claude Opus (SSE streaming)              │
                         │  briefing-tokens → word-by-word streaming endpoint         │
                         └─────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
                         ┌─────────────────────────────────────────────────────────────┐
                         │              BACKEND API (FastAPI + SSE)                    │
                         │                                                             │
                         │  /api/vessels · /api/risk · /api/briefing · /api/market   │
                         │  /api/heatmap · /api/predictions · /api/fleet-graph        │
                         │  /api/throughput · /api/geofences · /api/telemetry         │
                         │  /api/query (SSE) · /stream/briefing-tokens (SSE)          │
                         │  /api/replay/* · /rss · /embed                             │
                         └─────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
                         ┌─────────────────────────────────────────────────────────────┐
                         │              FRONTEND (React + Mapbox + D3)                 │
                         │                                                             │
                         │  LIVE MAP tab:                                              │
                         │    Mapbox GL JS — vessels, trails, tanker lanes            │
                         │    HeatmapLayer — risk fill overlay                        │
                         │    TrajectoryLayer — dashed prediction lines               │
                         │    GeofenceStudio — Mapbox Draw + floating zone list       │
                         │                                                             │
                         │  INTEL FEED tab: live event scroll                         │
                         │                                                             │
                         │  DATA & CHARTS tab: TransitChart, PolymarketWidget,        │
                         │    HealthDashboard, IncidentTimeline, BriefingPanel        │
                         │                                                             │
                         │  ANALYTICS tab:                                             │
                         │    NLQueryPanel — Claude chat                              │
                         │    StreamingBriefing — live token stream                  │
                         │    FleetGraph — D3 force-directed proximity graph         │
                         │    ThroughputWidget — bbl/day bar chart                   │
                         │    TelemetryPanel — pipeline metrics                       │
                         │    ReplayControls — AIS historical playback               │
                         └─────────────────────────────────────────────────────────────┘
```

---

## Tech stack table

| Layer | Technology | Notes |
|---|---|---|
| Message broker | Apache Kafka (Aiven) | 8 topics; 7-day retention |
| Stream processing | Apache Flink 1.18.1 | Deployed on Ververica Cloud; 12 detectors |
| CEP | Apache Flink CEP | Pattern-based multi-signal correlation |
| Geospatial | JTS (locationtech jts-core 1.19.0) | Polygon containment for dynamic geofences |
| AI briefing | Claude Haiku / Sonnet | Tiered by risk score; ~$0.02–0.15/day |
| AI query | Claude Opus (streaming) | SSE token stream for NL analyst queries |
| Backend | FastAPI 0.111, Python 3.12 | 20+ endpoints; SSE for live data |
| AIS replay | asyncio + JSONL | Records live positions; replays at up to 20× |
| Frontend | React 19, Vite 8 | SPA; no Next.js |
| Map | Mapbox GL JS 3 | Vessel icons, trail lines, heatmap, draw tool |
| Graph | D3 v7 | Force-directed fleet proximity graph |
| Charts | Recharts 3 | Throughput bar chart |
| Geofence drawing | @mapbox/mapbox-gl-draw 1 | Analyst polygon tool |
| AIS data | AISStream.io WebSocket | Primary; supplemented by MarineTraffic + AISHub |
| Market data | Yahoo Finance (yfinance) | 30s polling; 30+ tickers |
| News data | Reuters, Al Jazeera, AP, USNI RSS | Keyword + sentiment scoring |
| Prediction markets | Polymarket + Kalshi | Iran/Hormuz event contracts |
| Build | Maven (Flink JAR), npm (frontend) | 37MB fat JAR for Flink; 2.5MB JS bundle |
| Tests | JUnit 5 + Maven Surefire (Flink); pytest + pytest-asyncio (backend) | 33 Flink tests; 21 backend tests |

---

## Numbers that matter

Display these as a stats bar or callout block on the page:

| Metric | Value |
|---|---|
| Kafka topics | 14 |
| Flink stream processors | 12 (6 original + 6 new) |
| API endpoints | 20+ |
| React components | 25+ |
| Test coverage | 54 tests (33 Flink JUnit + 21 Python pytest) |
| AIS data sources | 3 (AISStream, MarineTraffic, AISHub) |
| Daily LLM cost | ~$0.02–$0.15 |
| Strait throughput modelled | ~20% of world daily oil supply |
| Flink JAR size | 37 MB |
| JS bundle (gzipped) | ~694 KB |

---

## Screenshots / visuals guidance

*Replace these placeholders with actual screenshots when the live deployment is running.*

1. **Hero image** — Full-screen dark map of the Strait of Hormuz. Orange tanker icons scattered across the water. Cyan dashed tanker lane lines. The risk heatmap glowing amber-red over the strait mouth. The vessel breakdown badge top-left: `187 vessels · 42 tankers · 3 mil`.

2. **ANALYTICS tab** — Show the NLQueryPanel with a question typed in and a streamed answer visible. Below it, the fleet graph with node clusters, and the ThroughputWidget showing `14.00M bbl/day`.

3. **Intel feed** — The scrolling intelligence feed with severity badges: a CRITICAL multi-signal correlation event at the top, several HIGH geofence breach events below, market ticks at the bottom.

4. **GeofenceStudio** — The map with a red polygon drawn around the Larak Island anchorage, and the floating panel showing the zone in the list with the ✕ delete button.

5. **Architecture diagram** — Use the ASCII diagram above, rendered cleanly (monospace block or a proper diagram tool).

---

## Design notes for Claude Code

- **Colour palette:** Deep navy background (`#030810`), electric cyan accent (`#00d4ff`), amber for warning (`#f59e0b`), red for critical (`#ef4444`), muted slate for secondary text (`#64748b`). These match the dashboard itself.
- **Typography:** Monospace for data values and labels. Clean sans-serif for body text and headings.
- **Aesthetic:** Technical, intelligence-terminal feel. Not corporate. Think Bloomberg terminal meets OSINT workstation.
- **Code blocks:** Use for the architecture diagram, any command snippets, and the stack table.
- **Mobile:** The project page itself doesn't need to be a full dashboard — a clean, scrollable project page is fine. The live dashboard link handles the interactive experience.
- **Tone:** First-person, confident, technically precise. This is a portfolio piece demonstrating serious engineering — streaming, AI, geospatial, real-time — not a toy project.

---

## Why I built this — author's note

*(This is the copy for the "Why I built it" section. Write it as a personal statement.)*

The Strait of Hormuz carries roughly one-fifth of the world's daily oil supply through a passage 33 kilometres wide at its narrowest point. In April 2025, with US–Iran tensions at a decade high, I kept watching news headlines but couldn't find anything that showed me what was actually happening in the strait, in real time.

I'd built AISGuardian — a similar system for Baltic Sea infrastructure protection — and knew that the data existed. AIS transponders broadcast from every commercial vessel. News feeds were parseable. Commodity prices were accessible. What didn't exist was a system that connected all three streams, found the patterns, and explained what they meant.

So I built it. HormuzWatch started as a Kafka + Flink + React stack that ingested AIS data and flagged anomalies. Then I added Claude to turn the anomaly stream into intelligible briefings. Then I added market data, prediction markets, precedent-aware context, and a second sprint that added ten new Flink processors, a real-time NL query interface, trajectory forecasting, and an analyst geofence studio.

The result is a system I actually use. When something happens at Hormuz, I open the dashboard.

---

## Related projects on the site

- **AISGuardian** — Maritime vessel tracking for Baltic Sea critical infrastructure. The predecessor to HormuzWatch, built during the Aiven Kafka Challenge.

---

*Built by Jaime Lopez · April 2026*
*Stack: Apache Flink · Ververica Cloud · Apache Kafka · Claude AI · FastAPI · React · Mapbox GL*
