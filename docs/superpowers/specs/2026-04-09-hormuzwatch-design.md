# HormuzWatch — Design Specification

**Date:** 2026-04-09  
**Status:** Approved  
**Project directory:** `/Users/Jaime/claude-work/hormuzwatch`  
**Reference project:** `/Users/Jaime/claude-personal/aiven-kafka-challenge` (AISGuardian)

---

## 1. Project Overview

HormuzWatch is a near-real-time public intelligence dashboard monitoring the maritime situation in the Strait of Hormuz in the context of the ongoing US+Israel / Iran conflict. It synthesizes three data streams — live AIS vessel tracking, news events, and commodity/equity market signals — into a unified mission-control interface powered by an AI narrative briefing engine.

### Goals

- Provide the public with a single, beautiful interface to understand what is happening in the Strait of Hormuz right now
- Connect maritime events to real economic consequences (commodity prices, tanker stocks, energy equities)
- Generate an AI situation report that updates in near-real-time as events unfold
- Go viral: be the dashboard that journalists, traders, and curious people share
- Run on free/low-cost infrastructure (Aiven Kafka free tier, Ververica Cloud Flink, Claude API with cost controls)

### Non-goals

- Tracking outside the Strait of Hormuz / Persian Gulf region
- User accounts, authentication, or personalization
- Historical analytics beyond 72-hour trailing data
- Mobile-native app (responsive web only)

---

## 2. Architecture Overview

```
AISStream.io WebSocket          RSS Feeds (Reuters, AJ, AP)     Yahoo Finance
      │                                  │                            │
      ▼                                  ▼                            ▼
 ais-connector.py               news-poller.py (60s)         market-poller.py (30s)
      │                                  │                            │
      └──────────────┬───────────────────┴────────────────────────────┘
                     ▼
              AIVEN KAFKA (5 topics, free tier)
         ┌────────────────────────────────────┐
         │  ais-positions    (raw AIS feed)   │
         │  news-events      (parsed RSS)     │
         │  market-ticks     (price snapshots)│
         │  intelligence-events (Flink output)│
         │  briefings        (LLM output)     │
         └──────────────────┬─────────────────┘
                            │
                   VERVERICA CLOUD (Flink)
         ┌────────────────────────────────────┐
         │  TrafficVolumeDetector             │
         │  MilitaryProximityDetector         │
         │  TankerConcentrationDetector       │
         │  DarkAISDetector  (from AISGuardian│
         │  SlowdownDetector                  │
         │  NewsAISCorrelator                 │
         └──────────────────┬─────────────────┘
                            │ intelligence-events
                            ▼
                   LLM SYNTHESIZER (Python)
         ┌────────────────────────────────────┐
         │  Delta-based triggering            │
         │  Significance scoring              │
         │  Model tiering (Haiku / Sonnet)    │
         │  2-min hard minimum interval       │
         └──────────────────┬─────────────────┘
                            │ briefings topic
                            ▼
                   FastAPI Backend
                   SSE streaming to browser
                            │
                   React Frontend
                   Mapbox GL · Cyber Ops UI
```

---

## 3. Data Sources

### 3.1 AIS Vessel Positions
- **Source:** AISStream.io WebSocket (`wss://stream.aisstream.io/v0/stream`)
- **Bounding box:** Strait of Hormuz + Persian Gulf — `22°N–28°N, 54°E–62°E`
- **Message types:** Position reports (Type 1/2/3/18), Static data (Type 5)
- **Fields used:** MMSI, name, ship type, flag state, lat, lon, speed, heading, nav status
- **Compression:** GZIP on all Kafka messages (same as AISGuardian)
- **Adapted from:** `AISGuardian/ingestion/ais_connector.py`

### 3.2 News Events
- **Source:** RSS polling — Reuters World, Al Jazeera English, Associated Press, USNI News
- **Polling interval:** Every 60 seconds
- **Filter:** Headlines/summaries containing keywords: `Iran`, `Hormuz`, `tanker`, `IRGC`, `sanctions`, `oil`, `strait`, `Persian Gulf`
- **Schema:** `{ id, source, headline, summary, url, published_at, keywords_matched, sentiment_score }`
- **Sentiment:** Keyword-based scoring (no external API): escalation terms = negative, de-escalation = positive

### 3.3 Market Data
- **Source:** Yahoo Finance unofficial API (yfinance Python library) — no API key required
- **Symbols tracked:**
  - Commodities: WTI Crude (`CL=F`), Brent Crude (`BZ=F`), Natural Gas (`NG=F`)
  - Tanker stocks: Frontline (`FRO`), Scorpio Tankers (`STNG`), DHT Holdings (`DHT`)
  - Energy majors: ExxonMobil (`XOM`), Chevron (`CVX`), BP (`BP`)
  - Defense ETF: iShares U.S. Aerospace & Defense (`ITA`)
  - Shipping index proxy: ZIM Integrated (`ZIM`)
- **Polling interval:** Every 30 seconds
- **Schema:** `{ symbol, name, price, change_pct, timestamp }`

---

## 4. Kafka Topics

Aiven free tier allows 5 topics with 2 partitions each, 250 kb/s total throughput, 3-day retention.

| Topic | Producer | Consumer | Partitions | Key |
|---|---|---|---|---|
| `ais-positions` | ais-connector.py | Flink | 2 | MMSI |
| `news-events` | news-poller.py | Flink | 1 | source |
| `market-ticks` | market-poller.py | Backend, Flink | 1 | symbol |
| `intelligence-events` | Flink | LLM Synthesizer | 1 | event_type |
| `briefings` | LLM Synthesizer | Backend | 1 | — |

---

## 5. Flink Detectors

All detectors run in parallel on Ververica Cloud. Job entry point: `HormuzWatchJob.java`.

### 5.1 TrafficVolumeDetector
- **Input:** `ais-positions`
- **Logic:** 1-hour tumbling windows count vessels in the strait bounding box. Compare to rolling 30-day hourly baseline (stored in Flink state). Deviation > 30% up or down triggers alert.
- **Output severity:** HIGH (drop), MEDIUM (surge)
- **Risk score contribution:** 15 points per 10% deviation

### 5.2 MilitaryProximityDetector
- **Input:** `ais-positions` (primary), `reference-data` (broadcast: known IRGCN/USN MMSIs and ship types)
- **Logic:** Broadcast state of military vessel MMSIs. Alert when military vessel comes within 5nm of a tanker or the tanker transit lane centerline.
- **Output severity:** HIGH (proximity), CRITICAL (intercept pattern — closing speed + heading convergence)
- **Risk score contribution:** 20 points (HIGH), 35 points (CRITICAL)

### 5.3 TankerConcentrationDetector
- **Input:** `ais-positions`
- **Logic:** Spatial grid (0.5° cells). Alert when 5+ tankers cluster in one cell and average speed < 2kt, outside known anchorage zones. Indicates vessels waiting / avoiding transit.
- **Output severity:** MEDIUM
- **Risk score contribution:** 10 points per cluster detected

### 5.4 DarkAISDetector
- **Input:** `ais-positions`
- **Logic:** Per-MMSI processing time timers. Alert if no update received in 30 minutes and last known position was within the strait corridor (not in port). Adapted directly from AISGuardian.
- **Output severity:** HIGH
- **Risk score contribution:** 12 points

### 5.5 SlowdownDetector
- **Input:** `ais-positions`
- **Logic:** Per-MMSI keyed state. Alert when tanker/cargo vessel drops from > 10kt to < 3kt within 20 minutes, outside port approach corridors.
- **Output severity:** MEDIUM (single vessel), HIGH (3+ vessels simultaneously)
- **Risk score contribution:** 8 points (MEDIUM), 18 points (HIGH)

### 5.6 NewsAISCorrelator
- **Input:** `news-events`, `intelligence-events`
- **Logic:** 10-minute event-time windows. If a news event with negative sentiment arrives in the same window as any HIGH/CRITICAL intelligence event, emit an escalation signal. This is the key cross-stream join.
- **Output severity:** HIGH (news + anomaly), CRITICAL (news + CRITICAL anomaly)
- **Risk score contribution:** 25 points (escalation signal)

### Composite Risk Score
The backend maintains a composite risk score (0–100) summing active detector contributions with decay:
- Scores decay by 5 points every 10 minutes without reinforcing events
- Hard minimum: 5 (baseline, strait always has some risk)
- Color mapping: 0–39 = LOW (green), 40–59 = ELEVATED (yellow), 60–79 = HIGH (orange), 80–100 = CRITICAL (red)

---

## 6. LLM Synthesizer

A standalone Python service that consumes `intelligence-events`, maintains the composite risk score, and calls Claude to generate the situation briefing.

### 6.1 Triggering Logic

```python
def should_trigger(event, current_score, last_score, last_call_time):
    # Hard minimum interval
    if time.now() - last_call_time < 120:  # 2 minutes
        return False
    # CRITICAL events always trigger (after interval)
    if event.severity == "CRITICAL":
        return True
    # Score delta threshold
    if abs(current_score - last_score) >= 8:
        return True
    # Extended quiet hours (02:00–06:00 UTC) — 10-min minimum
    if quiet_hours() and time.now() - last_call_time < 600:
        return False
    return False
```

### 6.2 Model Tiering

| Risk Score | Model | Approx cost/call |
|---|---|---|
| 0–39 (LOW) | claude-haiku-4-5 | ~$0.0003 |
| 40–79 (ELEVATED/HIGH) | claude-sonnet-4-6 | ~$0.003 |
| 80–100 (CRITICAL) | claude-sonnet-4-6 | ~$0.003 |

**Estimated daily cost:** 20–40 calls/day → **$0.02–$0.15/day** (vs $6/day naive)

### 6.3 Prompt Design

The system prompt embeds:
- Current vessel positions summary (count, flagged, military)
- Active intelligence events (last 10, with severity)
- Latest news headlines (last 5 matching keywords)
- Current market prices and % changes
- **Historical precedent table:**
  ```
  2019 Tanker Attacks (Jun–Jul 2019): Brent +$3–10, FRO +18%
  2012 Iran Sanctions Threat: Brent +15%, strait closure rhetoric peaked
  2011 Iran Strait Threat: Brent +8%, resolved within 2 weeks
  2019 Abqaiq Attack (Sep): WTI +15% intraday, settled +6%
  ```

The briefing output schema:
```json
{
  "headline": "string (1 sentence, punchy)",
  "body": "string (3–5 sentences, analyst voice)",
  "risk_score": 0-100,
  "key_drivers": ["string", "string", "string"],
  "market_outlook": "string (1–2 sentences on commodity/equity implications)",
  "confidence": "LOW|MEDIUM|HIGH",
  "generated_at": "ISO timestamp",
  "model_used": "string"
}
```

---

## 7. Backend (FastAPI)

Adapted from `AISGuardian/backend/api.py`.

### Key endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/vessels` | GET | All vessels in viewport (bbox query params) |
| `/api/briefing` | GET | Latest LLM situation report |
| `/api/market` | GET | Current market signals |
| `/api/risk` | GET | Current composite risk score + breakdown |
| `/stream/vessels` | SSE | Real-time vessel position updates |
| `/stream/events` | SSE | Real-time intelligence events feed |
| `/stream/briefing` | SSE | Push new briefings when available |

### State management
- Vessels: in-memory dict, 6-hour TTL, 5,000 vessel max (Persian Gulf has ~500–800 active)
- Briefings: last 10 cached, serve latest to new connections
- Market: last tick per symbol, updated in-place
- Intelligence events: deque(maxlen=200)

---

## 8. Frontend

### Tech stack
- React 18 + Vite
- Mapbox GL JS 3.0 (same version as AISGuardian)
- Tailwind CSS 3.4
- Lucide React icons
- Adapted from `AISGuardian/frontend/`

### Layout (single page, no routing)

```
┌────────────────────────────────────────────────────────────────────┐
│  ⚓ HORMUZWATCH   ● LIVE   [THREAT LEVEL BAR]  72/100   HH:MM:SS  │
├────────────────────────────────────┬───────────────────────────────┤
│                                    │  // AI SITUATION REPORT       │
│                                    │  ─────────────────────────    │
│   MAPBOX GL MAP                    │  [headline in large type]     │
│   Center: 26.5°N, 56.3°E          │  [body paragraph]             │
│   Zoom: 7 (strait + gulf)          │                               │
│                                    │  Drivers: [tag] [tag] [tag]   │
│   Layers:                          │  Confidence: HIGH             │
│   • Vessel icons (type-colored)    │  Updated: 2 min ago           │
│   • Tanker lane overlay            │                               │
│   • Military exclusion zones       │  // MARKET SIGNALS            │
│   • AIS trail lines (12h)          │  ─────────────────────────    │
│   • Alert markers                  │  WTI   $94.20  ▲ +3.4%       │
│                                    │  BRENT $98.70  ▲ +2.1%       │
│   [Filters: Tankers | Military |   │  FRO   $18.20  ▲ +5.1%       │
│    Cargo | All | Alerts only]      │  CLOSURE RISK   34%  ▲ 22pp  │
│                                    │                               │
│                                    │  // HISTORICAL CONTEXT        │
├────────────────────────────────────┤  2019 Attacks: Brent +$10    │
│  // LIVE INTELLIGENCE FEED         │  2012 Sanctions: +15%         │
│  [scrolling AIS + news events]     │  2011 Threat: +8%             │
└────────────────────────────────────┴───────────────────────────────┘
```

### Visual Design System (Cyber Ops)

| Token | Value | Usage |
|---|---|---|
| Background | `#060a0f` | Page background |
| Surface | `#071520` | Cards, panels |
| Border | `#0f2a40` | Panel borders |
| Primary | `#00d4ff` | Headings, active indicators, vessel icons |
| Text | `#94a3b8` | Body text |
| Text bright | `#e2e8f0` | Values, numbers |
| Critical | `#ef4444` | CRITICAL severity, closure risk high |
| High | `#f97316` | HIGH severity |
| Medium | `#f59e0b` | MEDIUM severity, elevated risk |
| Low | `#22c55e` | LOW severity, price up (bullish) |
| Font body | Inter or system-ui | Panel text |
| Font mono | `JetBrains Mono` or monospace | Labels, values, timestamps |
| Glow effect | `box-shadow: 0 0 8px <color>` | Active alerts, live indicators |

### Vessel icon colors (Mapbox canvas)
- Tankers: `#f97316` (orange) — highest priority
- Military/naval: `#ef4444` (red) — always visible
- Cargo: `#7c3aed` (purple)
- LNG carriers: `#06b6d4` (teal)
- Other: `#64748b` (gray)

---

## 9. Project Structure

```
hormuzwatch/
├── ingestion/
│   ├── ais_connector.py        # AIS WebSocket → Kafka (from AISGuardian)
│   ├── reference_loader.py     # Load geofences + military zones
│   └── requirements.txt
├── news-poller/
│   ├── news_poller.py          # RSS feed scraper → Kafka
│   ├── market_poller.py        # yfinance price polling → Kafka
│   ├── sentiment.py            # Keyword-based sentiment scoring
│   └── requirements.txt
├── flink-jobs/
│   ├── pom.xml
│   └── src/main/java/com/hormuzwatch/
│       ├── HormuzWatchJob.java
│       ├── detectors/
│       │   ├── TrafficVolumeDetector.java
│       │   ├── MilitaryProximityDetector.java
│       │   ├── TankerConcentrationDetector.java
│       │   ├── DarkAISDetector.java          # from AISGuardian
│       │   ├── SlowdownDetector.java
│       │   └── NewsAISCorrelator.java
│       ├── models/
│       │   ├── VesselPosition.java
│       │   ├── NewsEvent.java
│       │   ├── MarketTick.java
│       │   └── IntelligenceEvent.java
│       └── utils/
│           └── GeoUtils.java                 # from AISGuardian
├── llm-synthesizer/
│   ├── synthesizer.py          # Main service: consume events, call Claude
│   ├── trigger.py              # Delta-based triggering + cost controls
│   ├── prompt_builder.py       # Assemble context window for Claude
│   ├── precedents.py           # Historical Hormuz incident data
│   └── requirements.txt
├── backend/
│   ├── api.py                  # FastAPI endpoints + SSE (from AISGuardian)
│   ├── state.py                # In-memory state management
│   └── requirements.txt
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── Header.jsx          # Threat level bar + live indicator
│       │   ├── Map.jsx             # Mapbox GL (from AISGuardian, restyled)
│       │   ├── BriefingPanel.jsx   # AI situation report
│       │   ├── MarketPanel.jsx     # Commodity + equity signals
│       │   ├── ContextPanel.jsx    # Historical precedents
│       │   └── IntelFeed.jsx       # Live scrolling event feed
│       ├── hooks/
│       │   ├── useVesselStream.js
│       │   ├── useBriefingStream.js
│       │   └── useMarketStream.js
│       └── utils/
│           └── geo.js              # from AISGuardian
├── reference-data/
│   ├── geofences/
│   │   ├── hormuz_strait.geojson   # Strait corridor polygon
│   │   ├── tanker_lanes.geojson    # TSS (Traffic Separation Scheme) lanes
│   │   ├── military_zones.geojson  # IRGCN patrol areas, US 5th Fleet zones
│   │   └── anchorage_zones.geojson # Known anchorages (exclude from alerts)
│   ├── vessels/
│   │   └── military_mmsi.json      # Known IRGCN/USN vessel MMSIs
│   └── precedents/
│       └── hormuz_incidents.json   # Historical events + market impact data
├── docs/
│   ├── superpowers/specs/
│   │   └── 2026-04-09-hormuzwatch-design.md   # this file
│   └── website-page.md                         # Portfolio page content
├── .env.example
├── .gitignore
├── start.sh
└── README.md
```

---

## 10. Environment Variables

```bash
# AIS
AISSTREAM_API_KEY=

# Kafka (Aiven)
KAFKA_BOOTSTRAP_SERVERS=
KAFKA_USERNAME=
KAFKA_PASSWORD=
KAFKA_CA_CERT_PATH=

# Claude API
ANTHROPIC_API_KEY=

# Mapbox
VITE_MAPBOX_TOKEN=

# Optional: Alpha Vantage fallback for market data
ALPHA_VANTAGE_API_KEY=
```

---

## 11. Deployment

| Service | Platform | Notes |
|---|---|---|
| Kafka | Aiven Free Tier | 5 topics, 250kb/s, SSL required |
| Flink | Ververica Cloud | Same as AISGuardian |
| Backend | Railway | Python, always-on free tier |
| Frontend | Vercel / Railway | Static build |
| AIS Connector | Railway | Persistent WebSocket process |
| News Poller | Railway | Scheduled every 60s |
| LLM Synthesizer | Railway | Event-driven, low-traffic |

---

## 12. Borrowed from AISGuardian

The following are direct ports (may need minor adaption for Hormuz context):

- `ingestion/ais_connector.py` → update bounding box, same pattern
- `flink-jobs/src/.../detectors/DarkAISDetector.java` → copy directly
- `flink-jobs/src/.../utils/GeoUtils.java` → copy directly
- `flink-jobs/src/.../models/AISPosition.java` → rename to VesselPosition, same fields
- `backend/api.py` → adapt SSE endpoints, add briefing/market endpoints
- `frontend/src/components/Map.jsx` → restyle, change center/zoom
- `frontend/src/utils/geo.js` → copy directly
- `frontend/src/hooks/useKafkaStream.js` → split into three stream hooks

---

*Design approved by Jaime Lopez, 2026-04-09.*
