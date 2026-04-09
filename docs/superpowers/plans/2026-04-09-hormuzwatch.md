# HormuzWatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build HormuzWatch — a near-real-time maritime intelligence dashboard for the Strait of Hormuz combining live AIS vessel tracking, news events, market signals, and AI-generated situation reports.

**Architecture:** Three ingestion services feed five Kafka topics → Apache Flink runs six anomaly detectors → LLM Synthesizer calls Claude (cost-controlled) → FastAPI backend serves SSE streams → React + Mapbox GL frontend.

**Tech Stack:** Python 3.11, Apache Flink 1.18.1 (Java 11), React 18 + Vite 5, Mapbox GL JS 3.0, Tailwind CSS 3.4, Kafka (Aiven free tier), Ververica Cloud, Claude API (Anthropic), yfinance, feedparser, kafka-python, FastAPI, sse-starlette

**Borrow from AISGuardian:** `/Users/Jaime/claude-personal/aiven-kafka-challenge`

---

## Phase 1: Project Foundation

### Task 1: Project scaffold, config files, and shared Kafka utilities

**Files:**
- Create: `ingestion/requirements.txt`
- Create: `ingestion/kafka_utils.py`
- Create: `news-poller/requirements.txt`
- Create: `llm-synthesizer/requirements.txt`
- Create: `backend/requirements.txt`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Create `ingestion/requirements.txt`**

```
kafka-python==2.0.2
websockets==12.0
python-dotenv==1.0.0
```

- [ ] **Step 2: Create `news-poller/requirements.txt`**

```
kafka-python==2.0.2
feedparser==6.0.11
yfinance==0.2.36
python-dotenv==1.0.0
```

- [ ] **Step 3: Create `llm-synthesizer/requirements.txt`**

```
kafka-python==2.0.2
anthropic==0.34.0
python-dotenv==1.0.0
```

- [ ] **Step 4: Create `backend/requirements.txt`**

```
kafka-python==2.0.2
fastapi==0.111.0
uvicorn==0.30.1
sse-starlette==2.1.0
python-dotenv==1.0.0
```

- [ ] **Step 5: Create `ingestion/kafka_utils.py`** — shared Kafka helper reused by all Python services

```python
import json
import os
import ssl
from kafka import KafkaProducer, KafkaConsumer


def _ssl_context():
    ca_path = os.environ["KAFKA_CA_CERT_PATH"]
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(ca_path)
    return ctx


def make_producer():
    return KafkaProducer(
        bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"].split(","),
        security_protocol="SSL",
        ssl_context=_ssl_context(),
        sasl_mechanism=None,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        compression_type="gzip",
        linger_ms=100,
        batch_size=16384,
    )


def make_consumer(topics, group_id):
    return KafkaConsumer(
        *topics,
        bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"].split(","),
        security_protocol="SSL",
        ssl_context=_ssl_context(),
        group_id=group_id,
        auto_offset_reset="latest",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
    )
```

- [ ] **Step 6: Copy `kafka_utils.py` into `news-poller/`, `llm-synthesizer/`, and `backend/`**

```bash
cp ingestion/kafka_utils.py news-poller/kafka_utils.py
cp ingestion/kafka_utils.py llm-synthesizer/kafka_utils.py
cp ingestion/kafka_utils.py backend/kafka_utils.py
```

- [ ] **Step 7: Create `.env.example`**

```bash
# AIS
AISSTREAM_API_KEY=your_key_here

# Kafka (Aiven)
KAFKA_BOOTSTRAP_SERVERS=your-kafka.aivencloud.com:12345
KAFKA_CA_CERT_PATH=./certs/ca.pem

# Claude
ANTHROPIC_API_KEY=sk-ant-...

# Mapbox (frontend)
VITE_MAPBOX_TOKEN=pk.eyJ1...
```

- [ ] **Step 8: Create `README.md`** with setup instructions

```markdown
# HormuzWatch

Real-time maritime intelligence for the Strait of Hormuz.

## Services

| Service | Directory | Runtime |
|---|---|---|
| AIS Connector | `ingestion/` | Python |
| News + Market Poller | `news-poller/` | Python |
| Flink Detectors | `flink-jobs/` | Java 11 |
| LLM Synthesizer | `llm-synthesizer/` | Python |
| Backend API | `backend/` | Python |
| Frontend | `frontend/` | Node 20 |

## Quick Start

1. Copy `.env.example` to `.env` and fill in credentials
2. Place Aiven CA cert at path specified by `KAFKA_CA_CERT_PATH`
3. `./start.sh`

## Kafka Topics

- `ais-positions` — raw AIS vessel positions (Hormuz bbox)
- `news-events` — filtered RSS headlines
- `market-ticks` — commodity + equity price snapshots
- `intelligence-events` — Flink anomaly detector output
- `briefings` — Claude situation report JSON
```

- [ ] **Step 9: Commit**

```bash
git add ingestion/ news-poller/ llm-synthesizer/ backend/ .env.example README.md
git commit -m "feat: project scaffold and shared Kafka utilities"
```

---

### Task 2: Reference data — geofences, military MMSIs, incident precedents

**Files:**
- Create: `reference-data/geofences/hormuz_strait.geojson`
- Create: `reference-data/geofences/tanker_lanes.geojson`
- Create: `reference-data/geofences/anchorage_zones.geojson`
- Create: `reference-data/vessels/military_mmsi.json`
- Create: `reference-data/precedents/hormuz_incidents.json`

- [ ] **Step 1: Create `reference-data/geofences/hormuz_strait.geojson`** — Strait of Hormuz corridor polygon

```json
{
  "type": "Feature",
  "properties": { "name": "Strait of Hormuz Corridor", "type": "strait" },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[
      [56.0, 25.5], [57.5, 25.5], [58.0, 26.2],
      [57.8, 27.0], [56.5, 27.2], [55.8, 26.8],
      [56.0, 25.5]
    ]]
  }
}
```

- [ ] **Step 2: Create `reference-data/geofences/tanker_lanes.geojson`** — IMO Traffic Separation Scheme lanes

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Inbound Lane", "direction": "inbound" },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [56.45, 26.35], [56.70, 26.20], [57.10, 26.05]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Outbound Lane", "direction": "outbound" },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [57.10, 26.25], [56.70, 26.40], [56.45, 26.55]
        ]
      }
    }
  ]
}
```

- [ ] **Step 3: Create `reference-data/geofences/anchorage_zones.geojson`** — known anchorages to exclude from slowdown/cluster alerts

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Khor Fakkan Anchorage" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [56.35, 25.33], [56.45, 25.33],
          [56.45, 25.43], [56.35, 25.43], [56.35, 25.33]
        ]]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Fujairah Anchorage" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[
          [56.33, 25.10], [56.43, 25.10],
          [56.43, 25.20], [56.33, 25.20], [56.33, 25.10]
        ]]
      }
    }
  ]
}
```

- [ ] **Step 4: Create `reference-data/vessels/military_mmsi.json`**

```json
{
  "note": "Known IRGCN and US 5th Fleet vessel MMSIs. Supplement with ship_type=35 (military) AIS detection.",
  "irgcn": [
    { "mmsi": "422000001", "name": "IRGCN Patrol", "type": "patrol_boat" },
    { "mmsi": "422000002", "name": "IRGCN Fast Attack", "type": "fast_attack" }
  ],
  "us5thfleet": [
    { "mmsi": "338000001", "name": "USS Unknown", "type": "destroyer" }
  ],
  "ship_types_military": [35, 36]
}
```

- [ ] **Step 5: Create `reference-data/precedents/hormuz_incidents.json`**

```json
[
  {
    "id": "tanker-attacks-2019",
    "date": "2019-06-13",
    "description": "IRGC attacks on MT Front Altair and MV Kokuka Courageous in Gulf of Oman",
    "brent_impact_usd": "+$3 to +$10 over 1 week",
    "wti_impact_pct": "+4.5%",
    "tanker_stocks_impact": "FRO +18%, STNG +14%",
    "resolution_days": 14,
    "closure_reached": false
  },
  {
    "id": "sanctions-threat-2012",
    "date": "2012-01-09",
    "description": "Iran threatened to close Strait of Hormuz in response to EU oil sanctions",
    "brent_impact_usd": "+$10 over 2 weeks",
    "wti_impact_pct": "+15%",
    "tanker_stocks_impact": "Tanker stocks +8-12%",
    "resolution_days": 21,
    "closure_reached": false
  },
  {
    "id": "strait-closure-threat-2011",
    "date": "2011-12-27",
    "description": "Iran threatened to close strait after US sanctions on central bank",
    "brent_impact_usd": "+$5",
    "wti_impact_pct": "+8%",
    "tanker_stocks_impact": "Mixed, +5% avg",
    "resolution_days": 10,
    "closure_reached": false
  },
  {
    "id": "abqaiq-attack-2019",
    "date": "2019-09-14",
    "description": "Drone/missile strikes on Saudi Aramco Abqaiq facility (Houthi/Iran-linked)",
    "brent_impact_usd": "+$12 intraday, settled +$6",
    "wti_impact_pct": "+15% intraday",
    "tanker_stocks_impact": "Energy majors +3-5%",
    "resolution_days": 7,
    "closure_reached": false
  },
  {
    "id": "advantage-sweet-seizure-2023",
    "date": "2023-04-27",
    "description": "IRGC seized MV Advantage Sweet (Marshall Islands-flagged) in Gulf of Oman",
    "brent_impact_usd": "+$1.50",
    "wti_impact_pct": "+1.2%",
    "tanker_stocks_impact": "FRO +3%",
    "resolution_days": 90,
    "closure_reached": false
  }
]
```

- [ ] **Step 6: Commit**

```bash
git add reference-data/
git commit -m "feat: add reference data — geofences, military MMSIs, historical precedents"
```

---

## Phase 2: Data Ingestion

### Task 3: AIS Connector — WebSocket to Kafka (adapted from AISGuardian)

**Files:**
- Copy + modify: `ingestion/ais_connector.py` (from AISGuardian)
- Create: `ingestion/tests/test_ais_connector.py`

- [ ] **Step 1: Copy base from AISGuardian**

```bash
cp /Users/Jaime/claude-personal/aiven-kafka-challenge/ingestion/ais_connector.py ingestion/ais_connector.py
```

- [ ] **Step 2: Write the failing test**

Create `ingestion/tests/test_ais_connector.py`:

```python
import pytest
from ingestion.ais_connector import parse_position, is_in_hormuz_bbox

def test_parse_position_returns_expected_fields():
    raw = {
        "MessageType": "PositionReport",
        "MetaData": {"MMSI": 123456789, "ShipName": "TEST VESSEL", "time_utc": "2026-04-09 12:00:00"},
        "Message": {
            "PositionReport": {
                "Latitude": 26.5, "Longitude": 56.3,
                "Sog": 12.5, "Cog": 270.0,
                "TrueHeading": 268, "NavigationalStatus": 0
            }
        }
    }
    pos = parse_position(raw)
    assert pos["mmsi"] == 123456789
    assert pos["name"] == "TEST VESSEL"
    assert pos["lat"] == 26.5
    assert pos["lon"] == 56.3
    assert pos["speed"] == 12.5
    assert pos["heading"] == 268
    assert pos["nav_status"] == 0
    assert "timestamp" in pos

def test_in_hormuz_bbox():
    assert is_in_hormuz_bbox(26.5, 56.3) is True   # center of strait
    assert is_in_hormuz_bbox(51.5, 0.0) is False    # London
    assert is_in_hormuz_bbox(22.0, 54.0) is True    # bbox edge

def test_outside_hormuz_bbox():
    assert is_in_hormuz_bbox(30.0, 56.0) is False   # too far north
    assert is_in_hormuz_bbox(26.0, 50.0) is False   # too far west
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/Jaime/claude-work/hormuzwatch
python -m pytest ingestion/tests/test_ais_connector.py -v
```

Expected: FAIL — `parse_position` and `is_in_hormuz_bbox` not defined yet.

- [ ] **Step 4: Replace `ingestion/ais_connector.py`** with Hormuz-specific version

```python
"""AIS WebSocket connector — Strait of Hormuz / Persian Gulf."""
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone

import websockets
from dotenv import load_dotenv
from kafka_utils import make_producer

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Persian Gulf + Strait of Hormuz bounding box
HORMUZ_BBOX = {"min_lat": 22.0, "max_lat": 28.0, "min_lon": 54.0, "max_lon": 62.0}
AIS_WS_URL = "wss://stream.aisstream.io/v0/stream"
TOPIC = "ais-positions"


def is_in_hormuz_bbox(lat: float, lon: float) -> bool:
    b = HORMUZ_BBOX
    return b["min_lat"] <= lat <= b["max_lat"] and b["min_lon"] <= lon <= b["max_lon"]


def parse_position(raw: dict) -> dict | None:
    try:
        meta = raw["MetaData"]
        report = raw["Message"]["PositionReport"]
        lat = report["Latitude"]
        lon = report["Longitude"]
        if not is_in_hormuz_bbox(lat, lon):
            return None
        return {
            "mmsi": meta["MMSI"],
            "name": meta.get("ShipName", "").strip(),
            "lat": lat,
            "lon": lon,
            "speed": report.get("Sog", 0),
            "course": report.get("Cog", 0),
            "heading": report.get("TrueHeading", 511),
            "nav_status": report.get("NavigationalStatus", 15),
            "ship_type": meta.get("ShipType", 0),
            "flag": meta.get("MMSI_CountryCode", ""),
            "timestamp": meta.get("time_utc", datetime.now(timezone.utc).isoformat()),
        }
    except (KeyError, TypeError):
        return None


async def run():
    producer = make_producer()
    api_key = os.environ["AISSTREAM_API_KEY"]
    subscribe_msg = json.dumps({
        "APIKey": api_key,
        "BoundingBoxes": [[
            [HORMUZ_BBOX["min_lat"], HORMUZ_BBOX["min_lon"]],
            [HORMUZ_BBOX["max_lat"], HORMUZ_BBOX["max_lon"]],
        ]],
        "FilterMessageTypes": ["PositionReport"],
    })
    log.info("Connecting to AISStream for Hormuz bbox…")
    async with websockets.connect(AIS_WS_URL) as ws:
        await ws.send(subscribe_msg)
        async for raw_msg in ws:
            msg = json.loads(raw_msg)
            pos = parse_position(msg)
            if pos:
                producer.send(TOPIC, pos)


if __name__ == "__main__":
    asyncio.run(run())
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
python -m pytest ingestion/tests/test_ais_connector.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add ingestion/
git commit -m "feat: AIS connector for Hormuz bounding box"
```

---

### Task 4: News Poller — RSS feeds to Kafka

**Files:**
- Create: `news-poller/news_poller.py`
- Create: `news-poller/sentiment.py`
- Create: `news-poller/tests/test_news_poller.py`

- [ ] **Step 1: Write failing tests**

Create `news-poller/tests/test_news_poller.py`:

```python
import pytest
from news_poller import parse_entry, matches_keywords
from sentiment import score_sentiment

def test_parse_entry_extracts_fields():
    class FakeEntry:
        title = "Iran threatens tanker traffic in Hormuz"
        summary = "IRGC warns of disruption to oil shipping."
        link = "https://reuters.com/article/123"
        published = "Thu, 09 Apr 2026 10:00:00 GMT"

    result = parse_entry(FakeEntry(), source="reuters")
    assert result["headline"] == "Iran threatens tanker traffic in Hormuz"
    assert result["source"] == "reuters"
    assert result["url"] == "https://reuters.com/article/123"
    assert "published_at" in result

def test_matches_keywords_true():
    assert matches_keywords("Iran seizes tanker in Hormuz strait") is True
    assert matches_keywords("IRGC patrol boat intercepts oil vessel") is True

def test_matches_keywords_false():
    assert matches_keywords("UK election results announced") is False
    assert matches_keywords("Weather forecast for London") is False

def test_sentiment_negative_for_escalation():
    assert score_sentiment("Iran seizes tanker, threatens to close strait") < 0

def test_sentiment_positive_for_deescalation():
    assert score_sentiment("Iran and US reach diplomatic agreement, tensions ease") > 0

def test_sentiment_neutral():
    assert score_sentiment("Vessel transits Hormuz without incident") == 0
```

- [ ] **Step 2: Run to verify failure**

```bash
cd news-poller && python -m pytest tests/test_news_poller.py -v
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `news-poller/sentiment.py`**

```python
ESCALATION_TERMS = [
    "seize", "seized", "attack", "attacked", "intercept", "closure",
    "close", "threat", "threatens", "sanctions", "blockade", "missile",
    "military", "IRGC", "confrontation", "detained", "hostile",
]
DEESCALATION_TERMS = [
    "agreement", "diplomatic", "ease", "eased", "de-escalate", "calm",
    "negotiation", "ceasefire", "withdraw", "release", "resolve",
]

def score_sentiment(text: str) -> int:
    t = text.lower()
    score = 0
    for term in ESCALATION_TERMS:
        if term.lower() in t:
            score -= 1
    for term in DEESCALATION_TERMS:
        if term.lower() in t:
            score += 1
    return score
```

- [ ] **Step 4: Create `news-poller/news_poller.py`**

```python
"""RSS news poller — filters for Hormuz/Iran keywords, produces to Kafka."""
import hashlib
import logging
import os
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import feedparser
from dotenv import load_dotenv
from kafka_utils import make_producer
from sentiment import score_sentiment

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

FEEDS = [
    ("reuters", "https://feeds.reuters.com/reuters/worldNews"),
    ("aljazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
    ("usni", "https://news.usni.org/feed"),
    ("ap", "https://rsshub.app/apnews/topics/world-news"),
]

KEYWORDS = [
    "iran", "hormuz", "irgc", "tanker", "strait",
    "persian gulf", "oil sanctions", "gulf of oman",
]

TOPIC = "news-events"
POLL_INTERVAL = 60  # seconds
_seen: set[str] = set()


def matches_keywords(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in KEYWORDS)


def parse_entry(entry, source: str) -> dict:
    text = f"{entry.title} {getattr(entry, 'summary', '')}"
    try:
        published = parsedate_to_datetime(entry.published).isoformat()
    except Exception:
        published = datetime.now(timezone.utc).isoformat()
    return {
        "id": hashlib.md5(entry.link.encode()).hexdigest(),
        "source": source,
        "headline": entry.title,
        "summary": getattr(entry, "summary", ""),
        "url": entry.link,
        "published_at": published,
        "sentiment": score_sentiment(text),
        "keywords_matched": [kw for kw in KEYWORDS if kw in text.lower()],
    }


def poll_once(producer):
    for source, url in FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                text = f"{entry.title} {getattr(entry, 'summary', '')}"
                if not matches_keywords(text):
                    continue
                event = parse_entry(entry, source)
                if event["id"] in _seen:
                    continue
                _seen.add(event["id"])
                producer.send(TOPIC, event)
                log.info(f"[{source}] {entry.title[:80]}")
        except Exception as e:
            log.warning(f"Feed error {source}: {e}")


def run():
    producer = make_producer()
    log.info("News poller started.")
    while True:
        poll_once(producer)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
```

- [ ] **Step 5: Run tests**

```bash
cd news-poller && python -m pytest tests/test_news_poller.py -v
```

Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add news-poller/
git commit -m "feat: news poller with RSS feeds and keyword sentiment scoring"
```

---

### Task 5: Market Poller — prices to Kafka

**Files:**
- Create: `news-poller/market_poller.py`
- Create: `news-poller/tests/test_market_poller.py`

- [ ] **Step 1: Write failing tests**

Create `news-poller/tests/test_market_poller.py`:

```python
import pytest
from market_poller import format_tick, SYMBOLS

def test_symbols_contains_expected():
    symbols = [s["symbol"] for s in SYMBOLS]
    assert "CL=F" in symbols   # WTI Crude
    assert "BZ=F" in symbols   # Brent
    assert "FRO" in symbols    # Frontline

def test_format_tick():
    tick = format_tick("CL=F", "WTI Crude", 94.20, 91.00)
    assert tick["symbol"] == "CL=F"
    assert tick["name"] == "WTI Crude"
    assert tick["price"] == 94.20
    assert abs(tick["change_pct"] - 3.52) < 0.01
    assert "timestamp" in tick

def test_format_tick_zero_prev_price():
    tick = format_tick("CL=F", "WTI Crude", 94.20, 0)
    assert tick["change_pct"] == 0.0
```

- [ ] **Step 2: Run to verify failure**

```bash
cd news-poller && python -m pytest tests/test_market_poller.py -v
```

- [ ] **Step 3: Create `news-poller/market_poller.py`**

```python
"""Market data poller — commodity + equity prices to Kafka."""
import logging
import os
import time
from datetime import datetime, timezone

import yfinance as yf
from dotenv import load_dotenv
from kafka_utils import make_producer

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
    producer = make_producer()
    log.info("Market poller started.")
    while True:
        poll_once(producer)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
```

- [ ] **Step 4: Run tests**

```bash
cd news-poller && python -m pytest tests/test_market_poller.py -v
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add news-poller/market_poller.py news-poller/tests/test_market_poller.py
git commit -m "feat: market poller for commodities and equity prices via yfinance"
```

---

## Phase 3: Flink Stream Processing

### Task 6: Flink project structure, models, and build config

**Files:**
- Create: `flink-jobs/pom.xml`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/HormuzWatchJob.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/models/VesselPosition.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/models/NewsEvent.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/models/IntelligenceEvent.java`
- Copy: `flink-jobs/src/main/java/com/hormuzwatch/utils/GeoUtils.java` (from AISGuardian)

- [ ] **Step 1: Copy GeoUtils from AISGuardian**

```bash
mkdir -p flink-jobs/src/main/java/com/hormuzwatch/utils
mkdir -p flink-jobs/src/main/java/com/hormuzwatch/models
mkdir -p flink-jobs/src/main/java/com/hormuzwatch/detectors
mkdir -p flink-jobs/src/test/java/com/hormuzwatch
cp /Users/Jaime/claude-personal/aiven-kafka-challenge/flink-jobs/src/main/java/com/aiswatchdog/utils/GeoUtils.java \
   flink-jobs/src/main/java/com/hormuzwatch/utils/GeoUtils.java
sed -i '' 's/com.aiswatchdog/com.hormuzwatch/g' flink-jobs/src/main/java/com/hormuzwatch/utils/GeoUtils.java
```

- [ ] **Step 2: Create `flink-jobs/pom.xml`** (adapted from AISGuardian)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.hormuzwatch</groupId>
  <artifactId>hormuzwatch-flink</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
  <properties>
    <flink.version>1.18.1</flink.version>
    <java.version>11</java.version>
    <maven.compiler.source>11</maven.compiler.source>
    <maven.compiler.target>11</maven.compiler.target>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.apache.flink</groupId>
      <artifactId>flink-streaming-java</artifactId>
      <version>${flink.version}</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>org.apache.flink</groupId>
      <artifactId>flink-connector-kafka</artifactId>
      <version>3.1.0-1.18</version>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>2.15.3</version>
    </dependency>
    <dependency>
      <groupId>org.locationtech.jts</groupId>
      <artifactId>jts-core</artifactId>
      <version>1.19.0</version>
    </dependency>
    <dependency>
      <groupId>org.apache.flink</groupId>
      <artifactId>flink-test-utils</artifactId>
      <version>${flink.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-shade-plugin</artifactId>
        <version>3.5.0</version>
        <executions>
          <execution>
            <phase>package</phase>
            <goals><goal>shade</goal></goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

- [ ] **Step 3: Create `VesselPosition.java`**

```java
package com.hormuzwatch.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class VesselPosition {
    public long mmsi;
    public String name = "";
    public double lat;
    public double lon;
    public double speed;
    public double course;
    public int heading;
    public int navStatus;
    public int shipType;
    public String flag = "";
    public String timestamp;
}
```

- [ ] **Step 4: Create `NewsEvent.java`**

```java
package com.hormuzwatch.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class NewsEvent {
    public String id;
    public String source;
    public String headline;
    public String summary;
    public String url;
    public String publishedAt;
    public int sentiment;
}
```

- [ ] **Step 5: Create `IntelligenceEvent.java`**

```java
package com.hormuzwatch.models;

public class IntelligenceEvent {
    public String type;        // DARK_AIS, TRAFFIC_ANOMALY, MILITARY_PROXIMITY, etc.
    public String severity;    // CRITICAL, HIGH, MEDIUM, LOW
    public int scoreContribution;
    public String description;
    public long mmsi;
    public double lat;
    public double lon;
    public String timestamp;
    public String detectorName;
}
```

- [ ] **Step 6: Verify Flink project compiles**

```bash
cd flink-jobs && mvn compile -q
```

Expected: BUILD SUCCESS

- [ ] **Step 7: Commit**

```bash
cd ..
git add flink-jobs/
git commit -m "feat: Flink project structure, models, GeoUtils"
```

---

### Task 7: DarkAISDetector — vessels going silent in the strait

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/DarkAISDetector.java`
- Create: `flink-jobs/src/test/java/com/hormuzwatch/DarkAISDetectorTest.java`

- [ ] **Step 1: Copy and adapt from AISGuardian**

```bash
cp /Users/Jaime/claude-personal/aiven-kafka-challenge/flink-jobs/src/main/java/com/aiswatchdog/detectors/DarkAISDetector.java \
   flink-jobs/src/main/java/com/hormuzwatch/detectors/DarkAISDetector.java
# Update package and imports
sed -i '' 's/com\.aiswatchdog/com.hormuzwatch/g' \
  flink-jobs/src/main/java/com/hormuzwatch/detectors/DarkAISDetector.java
sed -i '' 's/AISPosition/VesselPosition/g' \
  flink-jobs/src/main/java/com/hormuzwatch/detectors/DarkAISDetector.java
sed -i '' 's/Alert/IntelligenceEvent/g' \
  flink-jobs/src/main/java/com/hormuzwatch/detectors/DarkAISDetector.java
```

- [ ] **Step 2: Write unit test**

Create `flink-jobs/src/test/java/com/hormuzwatch/DarkAISDetectorTest.java`:

```java
package com.hormuzwatch;

import com.hormuzwatch.detectors.DarkAISDetector;
import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class DarkAISDetectorTest {

    @Test
    public void testDarkEventThresholdIs30Minutes() {
        DarkAISDetector detector = new DarkAISDetector();
        assertEquals(30 * 60 * 1000L, detector.getDarkThresholdMs());
    }

    @Test
    public void testVesselPositionInStrait() {
        VesselPosition pos = new VesselPosition();
        pos.mmsi = 123456789L;
        pos.lat = 26.5;
        pos.lon = 56.3;
        pos.shipType = 80; // tanker
        assertTrue(DarkAISDetector.isInStraitCorridor(pos.lat, pos.lon));
    }

    @Test
    public void testVesselPositionOutsideStrait() {
        assertFalse(DarkAISDetector.isInStraitCorridor(51.5, 0.0)); // London
        assertFalse(DarkAISDetector.isInStraitCorridor(22.0, 50.0)); // outside bbox
    }
}
```

- [ ] **Step 3: Add `getDarkThresholdMs()` and `isInStraitCorridor()` to `DarkAISDetector.java` if not present from the AISGuardian copy**

Ensure the class has:

```java
public static final long DARK_THRESHOLD_MS = 30 * 60 * 1000L;

public long getDarkThresholdMs() {
    return DARK_THRESHOLD_MS;
}

// Hormuz strait corridor: lat 25.5-27.2, lon 55.8-58.0
public static boolean isInStraitCorridor(double lat, double lon) {
    return lat >= 25.5 && lat <= 27.2 && lon >= 55.8 && lon <= 58.0;
}
```

- [ ] **Step 4: Run tests**

```bash
cd flink-jobs && mvn test -pl . -Dtest=DarkAISDetectorTest -q
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ..
git add flink-jobs/
git commit -m "feat: DarkAISDetector adapted from AISGuardian for Hormuz corridor"
```

---

### Task 8: TrafficVolumeDetector — vessel count anomalies

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/TrafficVolumeDetector.java`
- Create: `flink-jobs/src/test/java/com/hormuzwatch/TrafficVolumeDetectorTest.java`

- [ ] **Step 1: Write the test**

```java
package com.hormuzwatch;

import com.hormuzwatch.detectors.TrafficVolumeDetector;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class TrafficVolumeDetectorTest {

    @Test
    public void testAnomalyDetectedWhenCountDrops30Percent() {
        // baseline = 100, current = 60 → -40% → should flag
        assertTrue(TrafficVolumeDetector.isAnomaly(100, 60));
    }

    @Test
    public void testNoAnomalyWithin30PercentThreshold() {
        // baseline = 100, current = 75 → -25% → within threshold
        assertFalse(TrafficVolumeDetector.isAnomaly(100, 75));
    }

    @Test
    public void testAnomalyDetectedWhenCountSurges30Percent() {
        // baseline = 100, current = 140 → +40% → flag
        assertTrue(TrafficVolumeDetector.isAnomaly(100, 140));
    }

    @Test
    public void testNoAnomalyWithZeroBaseline() {
        assertFalse(TrafficVolumeDetector.isAnomaly(0, 50));
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd flink-jobs && mvn test -Dtest=TrafficVolumeDetectorTest -q 2>&1 | head -20
```

- [ ] **Step 3: Create `TrafficVolumeDetector.java`**

```java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import java.time.Instant;

/**
 * 1-hour tumbling count of vessels in Hormuz bbox.
 * Fires HIGH alert when count deviates >30% from rolling baseline.
 */
public class TrafficVolumeDetector extends KeyedProcessFunction<String, VesselPosition, IntelligenceEvent> {

    private static final double ANOMALY_THRESHOLD = 0.30;
    private ValueState<Long> windowCount;
    private ValueState<Double> baseline;
    private ValueState<Long> windowStart;

    public static boolean isAnomaly(double baseline, long current) {
        if (baseline <= 0) return false;
        double deviation = Math.abs((current - baseline) / baseline);
        return deviation >= ANOMALY_THRESHOLD;
    }

    @Override
    public void open(Configuration cfg) {
        windowCount = getRuntimeContext().getState(new ValueStateDescriptor<>("count", Long.class));
        baseline = getRuntimeContext().getState(new ValueStateDescriptor<>("baseline", Double.class));
        windowStart = getRuntimeContext().getState(new ValueStateDescriptor<>("windowStart", Long.class));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx, Collector<IntelligenceEvent> out) throws Exception {
        long now = ctx.timerService().currentProcessingTime();
        Long ws = windowStart.value();
        if (ws == null) {
            windowStart.update(now);
            windowCount.update(1L);
            return;
        }
        long elapsed = now - ws;
        if (elapsed > 3_600_000L) { // 1 hour window
            long count = windowCount.value() == null ? 0 : windowCount.value();
            Double base = baseline.value();
            if (base != null && isAnomaly(base, count)) {
                IntelligenceEvent ev = new IntelligenceEvent();
                ev.type = "TRAFFIC_ANOMALY";
                ev.severity = count < base ? "HIGH" : "MEDIUM";
                ev.scoreContribution = 15;
                ev.description = String.format("Vessel count %d vs baseline %.0f (%.0f%% deviation)",
                    count, base, Math.abs((count - base) / base * 100));
                ev.lat = 26.5;
                ev.lon = 56.3;
                ev.timestamp = Instant.now().toString();
                ev.detectorName = "TrafficVolumeDetector";
                out.collect(ev);
            }
            // Update rolling baseline (exponential moving average)
            baseline.update(base == null ? count : base * 0.9 + count * 0.1);
            windowStart.update(now);
            windowCount.update(1L);
        } else {
            windowCount.update((windowCount.value() == null ? 0 : windowCount.value()) + 1);
            if (baseline.value() == null) baseline.update(0.0);
        }
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cd flink-jobs && mvn test -Dtest=TrafficVolumeDetectorTest -q
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ..
git add flink-jobs/
git commit -m "feat: TrafficVolumeDetector — 1hr window vessel count anomaly"
```

---

### Task 9: MilitaryProximityDetector, SlowdownDetector, TankerConcentrationDetector

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/MilitaryProximityDetector.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/SlowdownDetector.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/TankerConcentrationDetector.java`
- Create: `flink-jobs/src/test/java/com/hormuzwatch/DetectorsTest.java`

- [ ] **Step 1: Write tests for all three**

```java
package com.hormuzwatch;

import com.hormuzwatch.detectors.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class DetectorsTest {

    // MilitaryProximityDetector
    @Test
    public void testMilitaryShipTypeDetected() {
        assertTrue(MilitaryProximityDetector.isMilitary(35, 123456L, java.util.Set.of()));
        assertFalse(MilitaryProximityDetector.isMilitary(80, 123456L, java.util.Set.of()));
    }

    @Test
    public void testMilitaryMmsiDetected() {
        assertTrue(MilitaryProximityDetector.isMilitary(0, 422000001L, java.util.Set.of(422000001L)));
        assertFalse(MilitaryProximityDetector.isMilitary(0, 999999999L, java.util.Set.of()));
    }

    // SlowdownDetector
    @Test
    public void testSlowdownDetected() {
        assertTrue(SlowdownDetector.isSlowdown(12.0, 2.0));  // was 12kt, now 2kt
    }

    @Test
    public void testNoSlowdownWhenAlreadySlow() {
        assertFalse(SlowdownDetector.isSlowdown(2.0, 1.5));
    }

    @Test
    public void testNoSlowdownForSmallSpeedDrop() {
        assertFalse(SlowdownDetector.isSlowdown(12.0, 9.0));
    }

    // TankerConcentrationDetector
    @Test
    public void testClusterDetected() {
        assertTrue(TankerConcentrationDetector.isCluster(6, 1.2));  // 6 tankers, avg speed 1.2kt
    }

    @Test
    public void testNoClusterWhenMoving() {
        assertFalse(TankerConcentrationDetector.isCluster(6, 8.0));  // moving fast
    }

    @Test
    public void testNoClusterWhenTooFewVessels() {
        assertFalse(TankerConcentrationDetector.isCluster(3, 1.0));  // only 3
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cd flink-jobs && mvn test -Dtest=DetectorsTest -q 2>&1 | head -10
```

- [ ] **Step 3: Create `MilitaryProximityDetector.java`**

```java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import com.hormuzwatch.utils.GeoUtils;
import org.apache.flink.streaming.api.functions.ProcessFunction;
import org.apache.flink.util.Collector;
import java.time.Instant;
import java.util.Set;

public class MilitaryProximityDetector extends ProcessFunction<VesselPosition, IntelligenceEvent> {

    private static final double PROXIMITY_NM = 5.0;
    // Tanker lane centerline approximate midpoint
    private static final double LANE_LAT = 26.3;
    private static final double LANE_LON = 56.8;

    public static boolean isMilitary(int shipType, long mmsi, Set<Long> knownMmsis) {
        return shipType == 35 || shipType == 36 || knownMmsis.contains(mmsi);
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx, Collector<IntelligenceEvent> out) {
        if (!isMilitary(pos.shipType, pos.mmsi, Set.of())) return;
        double distNm = GeoUtils.distanceNm(pos.lat, pos.lon, LANE_LAT, LANE_LON);
        if (distNm <= PROXIMITY_NM) {
            IntelligenceEvent ev = new IntelligenceEvent();
            ev.type = "MILITARY_PROXIMITY";
            ev.severity = distNm <= 2.0 ? "CRITICAL" : "HIGH";
            ev.scoreContribution = distNm <= 2.0 ? 35 : 20;
            ev.mmsi = pos.mmsi;
            ev.lat = pos.lat;
            ev.lon = pos.lon;
            ev.description = String.format("Military vessel %d within %.1f nm of tanker lane", pos.mmsi, distNm);
            ev.timestamp = Instant.now().toString();
            ev.detectorName = "MilitaryProximityDetector";
            out.collect(ev);
        }
    }
}
```

- [ ] **Step 4: Create `SlowdownDetector.java`**

```java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import java.time.Instant;

public class SlowdownDetector extends KeyedProcessFunction<Long, VesselPosition, IntelligenceEvent> {

    private static final double FAST_THRESHOLD = 10.0;
    private static final double SLOW_THRESHOLD = 3.0;
    private ValueState<Double> lastSpeed;

    public static boolean isSlowdown(double prev, double current) {
        return prev >= FAST_THRESHOLD && current < SLOW_THRESHOLD;
    }

    @Override
    public void open(Configuration cfg) {
        lastSpeed = getRuntimeContext().getState(new ValueStateDescriptor<>("speed", Double.class));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx, Collector<IntelligenceEvent> out) throws Exception {
        Double prev = lastSpeed.value();
        if (prev != null && isSlowdown(prev, pos.speed)) {
            IntelligenceEvent ev = new IntelligenceEvent();
            ev.type = "VESSEL_SLOWDOWN";
            ev.severity = "MEDIUM";
            ev.scoreContribution = 8;
            ev.mmsi = pos.mmsi;
            ev.lat = pos.lat;
            ev.lon = pos.lon;
            ev.description = String.format("Vessel %d slowed %.1f→%.1f kt in strait", pos.mmsi, prev, pos.speed);
            ev.timestamp = Instant.now().toString();
            ev.detectorName = "SlowdownDetector";
            out.collect(ev);
        }
        lastSpeed.update(pos.speed);
    }
}
```

- [ ] **Step 5: Create `TankerConcentrationDetector.java`**

```java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.streaming.api.functions.windowing.ProcessWindowFunction;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;
import java.time.Instant;

public class TankerConcentrationDetector
        extends ProcessWindowFunction<VesselPosition, IntelligenceEvent, String, TimeWindow> {

    private static final int MIN_CLUSTER_SIZE = 5;
    private static final double MAX_AVG_SPEED_KT = 3.0;

    public static boolean isCluster(int vesselCount, double avgSpeed) {
        return vesselCount >= MIN_CLUSTER_SIZE && avgSpeed < MAX_AVG_SPEED_KT;
    }

    @Override
    public void process(String gridCell, Context ctx, Iterable<VesselPosition> vessels,
                        Collector<IntelligenceEvent> out) {
        int count = 0;
        double totalSpeed = 0;
        double sumLat = 0, sumLon = 0;
        for (VesselPosition v : vessels) {
            if (v.shipType >= 80 && v.shipType <= 89) { // tanker ship types
                count++;
                totalSpeed += v.speed;
                sumLat += v.lat;
                sumLon += v.lon;
            }
        }
        if (count == 0) return;
        double avgSpeed = totalSpeed / count;
        if (isCluster(count, avgSpeed)) {
            IntelligenceEvent ev = new IntelligenceEvent();
            ev.type = "TANKER_CONCENTRATION";
            ev.severity = "MEDIUM";
            ev.scoreContribution = 10;
            ev.lat = sumLat / count;
            ev.lon = sumLon / count;
            ev.description = String.format("%d tankers clustered in grid %s, avg speed %.1f kt", count, gridCell, avgSpeed);
            ev.timestamp = Instant.now().toString();
            ev.detectorName = "TankerConcentrationDetector";
            out.collect(ev);
        }
    }
}
```

- [ ] **Step 6: Run all detector tests**

```bash
cd flink-jobs && mvn test -Dtest=DetectorsTest,DarkAISDetectorTest,TrafficVolumeDetectorTest -q
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
cd ..
git add flink-jobs/
git commit -m "feat: MilitaryProximityDetector, SlowdownDetector, TankerConcentrationDetector"
```

---

### Task 10: NewsAISCorrelator and HormuzWatchJob main wiring

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/NewsAISCorrelator.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/HormuzWatchJob.java`
- Create: `flink-jobs/src/test/java/com/hormuzwatch/NewsAISCorrelatorTest.java`

- [ ] **Step 1: Write failing test**

```java
package com.hormuzwatch;

import com.hormuzwatch.detectors.NewsAISCorrelator;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class NewsAISCorrelatorTest {

    @Test
    public void testNegativeSentimentNewsIsEscalation() {
        assertTrue(NewsAISCorrelator.isEscalatingNews(-2));
        assertTrue(NewsAISCorrelator.isEscalatingNews(-1));
    }

    @Test
    public void testNeutralNewsIsNotEscalation() {
        assertFalse(NewsAISCorrelator.isEscalatingNews(0));
        assertFalse(NewsAISCorrelator.isEscalatingNews(1));
    }

    @Test
    public void testCorrelationSeverityEscalatesWithCritical() {
        assertEquals("CRITICAL", NewsAISCorrelator.correlatedSeverity("CRITICAL"));
        assertEquals("HIGH", NewsAISCorrelator.correlatedSeverity("HIGH"));
        assertEquals("HIGH", NewsAISCorrelator.correlatedSeverity("MEDIUM"));
    }
}
```

- [ ] **Step 2: Create `NewsAISCorrelator.java`**

```java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.NewsEvent;
import org.apache.flink.streaming.api.functions.co.ProcessJoinFunction;
import org.apache.flink.util.Collector;
import java.time.Instant;

/**
 * Temporal join: negative-sentiment news + any HIGH/CRITICAL intelligence event
 * within a 10-minute window → escalation signal.
 */
public class NewsAISCorrelator extends ProcessJoinFunction<NewsEvent, IntelligenceEvent, IntelligenceEvent> {

    public static boolean isEscalatingNews(int sentiment) {
        return sentiment < 0;
    }

    public static String correlatedSeverity(String aisEventSeverity) {
        if ("CRITICAL".equals(aisEventSeverity)) return "CRITICAL";
        return "HIGH";
    }

    @Override
    public void processElement(NewsEvent news, IntelligenceEvent aisEvent,
                               Context ctx, Collector<IntelligenceEvent> out) {
        if (!isEscalatingNews(news.sentiment)) return;
        if (!"HIGH".equals(aisEvent.severity) && !"CRITICAL".equals(aisEvent.severity)) return;

        IntelligenceEvent escalation = new IntelligenceEvent();
        escalation.type = "NEWS_AIS_CORRELATION";
        escalation.severity = correlatedSeverity(aisEvent.severity);
        escalation.scoreContribution = 25;
        escalation.lat = aisEvent.lat;
        escalation.lon = aisEvent.lon;
        escalation.description = String.format(
            "Escalation signal: \"%s\" correlated with %s event (%s)",
            news.headline, aisEvent.type, aisEvent.severity);
        escalation.timestamp = Instant.now().toString();
        escalation.detectorName = "NewsAISCorrelator";
        out.collect(escalation);
    }
}
```

- [ ] **Step 3: Create `HormuzWatchJob.java`** — wires all detectors together

```java
package com.hormuzwatch;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hormuzwatch.detectors.*;
import com.hormuzwatch.models.*;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.streaming.api.datastream.*;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.windowing.assigners.SlidingProcessingTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import java.time.Duration;
import java.util.Properties;

public class HormuzWatchJob {

    public static void main(String[] args) throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.enableCheckpointing(60_000);

        Properties kafkaProps = kafkaProperties();
        ObjectMapper mapper = new ObjectMapper();

        // --- Sources ---
        DataStream<VesselPosition> positions = kafkaSource(env, kafkaProps, "ais-positions",
            s -> mapper.readValue(s, VesselPosition.class));

        DataStream<NewsEvent> news = kafkaSource(env, kafkaProps, "news-events",
            s -> mapper.readValue(s, NewsEvent.class));

        // --- Detectors ---
        DataStream<IntelligenceEvent> dark = positions
            .keyBy(p -> p.mmsi)
            .process(new DarkAISDetector());

        DataStream<IntelligenceEvent> traffic = positions
            .keyBy(p -> "global")
            .process(new TrafficVolumeDetector());

        DataStream<IntelligenceEvent> military = positions
            .process(new MilitaryProximityDetector());

        DataStream<IntelligenceEvent> slowdowns = positions
            .keyBy(p -> p.mmsi)
            .process(new SlowdownDetector());

        DataStream<IntelligenceEvent> clusters = positions
            .filter(p -> p.shipType >= 80 && p.shipType <= 89)
            .keyBy(p -> gridCell(p.lat, p.lon))
            .window(SlidingProcessingTimeWindows.of(Time.minutes(30), Time.minutes(5)))
            .process(new TankerConcentrationDetector());

        // Merge all AIS intelligence events
        DataStream<IntelligenceEvent> allAisEvents = dark.union(traffic, military, slowdowns, clusters);

        // News × AIS correlation (10-min interval join)
        DataStream<IntelligenceEvent> correlations = news
            .keyBy(n -> "global")
            .intervalJoin(allAisEvents.keyBy(e -> "global"))
            .between(Time.minutes(-5), Time.minutes(5))
            .process(new NewsAISCorrelator());

        DataStream<IntelligenceEvent> allEvents = allAisEvents.union(correlations);

        // --- Sink: intelligence-events topic ---
        allEvents.sinkTo(kafkaSink(kafkaProps, "intelligence-events", mapper));

        env.execute("HormuzWatch Intelligence Pipeline");
    }

    private static String gridCell(double lat, double lon) {
        return String.format("%.1f_%.1f", Math.floor(lat * 2) / 2, Math.floor(lon * 2) / 2);
    }

    private static Properties kafkaProperties() {
        Properties p = new Properties();
        p.put("bootstrap.servers", System.getenv("KAFKA_BOOTSTRAP_SERVERS"));
        p.put("security.protocol", "SSL");
        p.put("ssl.truststore.location", System.getenv("KAFKA_TRUSTSTORE_PATH"));
        p.put("ssl.truststore.password", System.getenv("KAFKA_TRUSTSTORE_PASSWORD"));
        return p;
    }

    @FunctionalInterface
    interface Deserializer<T> { T apply(String s) throws Exception; }

    private static <T> DataStream<T> kafkaSource(StreamExecutionEnvironment env,
            Properties props, String topic, Deserializer<T> deser) {
        KafkaSource<String> src = KafkaSource.<String>builder()
            .setBootstrapServers(props.getProperty("bootstrap.servers"))
            .setTopics(topic)
            .setGroupId("hormuzwatch-flink")
            .setStartingOffsets(OffsetsInitializer.latest())
            .setValueOnlyDeserializer(new SimpleStringSchema())
            .setProperties(props)
            .build();
        return env.fromSource(src, WatermarkStrategy.noWatermarks(), topic)
            .map(s -> deser.apply(s));
    }

    private static KafkaSink<IntelligenceEvent> kafkaSink(Properties props, String topic, ObjectMapper mapper) {
        return KafkaSink.<IntelligenceEvent>builder()
            .setBootstrapServers(props.getProperty("bootstrap.servers"))
            .setKafkaProducerConfig(props)
            .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                .setTopic(topic)
                .setValueSerializationSchema((ev, ctx, ts) -> {
                    try { return mapper.writeValueAsBytes(ev); }
                    catch (Exception e) { return new byte[0]; }
                })
                .build())
            .build();
    }
}
```

- [ ] **Step 4: Run all Flink tests**

```bash
cd flink-jobs && mvn test -q
```

Expected: all tests PASS.

- [ ] **Step 5: Build the fat JAR**

```bash
cd flink-jobs && mvn package -DskipTests -q
ls target/hormuzwatch-flink-1.0.0.jar
```

Expected: JAR exists.

- [ ] **Step 6: Commit**

```bash
cd ..
git add flink-jobs/
git commit -m "feat: NewsAISCorrelator + HormuzWatchJob pipeline wiring"
```

---

## Phase 4: LLM Synthesizer

### Task 11: Trigger controller and precedents loader

**Files:**
- Create: `llm-synthesizer/trigger.py`
- Create: `llm-synthesizer/precedents.py`
- Create: `llm-synthesizer/tests/test_trigger.py`

- [ ] **Step 1: Write failing tests**

Create `llm-synthesizer/tests/test_trigger.py`:

```python
import time
import pytest
from trigger import TriggerController

def make_ctrl():
    return TriggerController()

def test_blocks_within_min_interval():
    ctrl = make_ctrl()
    ctrl.last_call_time = time.time()  # just called
    assert ctrl.should_trigger({"severity": "HIGH"}, 50, 50) is False

def test_allows_critical_after_interval():
    ctrl = make_ctrl()
    ctrl.last_call_time = time.time() - 130  # 130s ago
    assert ctrl.should_trigger({"severity": "CRITICAL"}, 50, 50) is True

def test_allows_score_delta_above_threshold():
    ctrl = make_ctrl()
    ctrl.last_call_time = time.time() - 130
    assert ctrl.should_trigger({"severity": "MEDIUM"}, 80, 70) is True  # delta=10 >= 8

def test_blocks_score_delta_below_threshold():
    ctrl = make_ctrl()
    ctrl.last_call_time = time.time() - 130
    assert ctrl.should_trigger({"severity": "MEDIUM"}, 75, 72) is False  # delta=3 < 8

def test_haiku_model_for_low_risk():
    ctrl = make_ctrl()
    assert "haiku" in ctrl.get_model(30).lower()

def test_sonnet_model_for_high_risk():
    ctrl = make_ctrl()
    assert "sonnet" in ctrl.get_model(45).lower()
    assert "sonnet" in ctrl.get_model(80).lower()
```

- [ ] **Step 2: Run to verify failure**

```bash
cd llm-synthesizer && python -m pytest tests/test_trigger.py -v
```

- [ ] **Step 3: Create `llm-synthesizer/trigger.py`**

```python
"""Cost-control trigger logic for LLM Synthesizer."""
import time
from datetime import datetime, timezone


class TriggerController:
    MIN_INTERVAL = 120          # 2 minutes
    QUIET_MIN_INTERVAL = 600    # 10 minutes during quiet hours
    SCORE_DELTA_THRESHOLD = 8
    QUIET_HOURS = (2, 6)        # UTC

    def __init__(self):
        self.last_call_time = 0.0
        self.last_score = 5

    def should_trigger(self, event: dict, current_score: int, last_score: int) -> bool:
        elapsed = time.time() - self.last_call_time
        min_interval = self._min_interval()
        if elapsed < min_interval:
            return False
        if event and event.get("severity") == "CRITICAL":
            return True
        if abs(current_score - last_score) >= self.SCORE_DELTA_THRESHOLD:
            return True
        return False

    def get_model(self, risk_score: int) -> str:
        if risk_score >= 40:
            return "claude-sonnet-4-6"
        return "claude-haiku-4-5-20251001"

    def record_call(self, score: int):
        self.last_call_time = time.time()
        self.last_score = score

    def _min_interval(self) -> float:
        hour = datetime.now(timezone.utc).hour
        if self.QUIET_HOURS[0] <= hour < self.QUIET_HOURS[1]:
            return self.QUIET_MIN_INTERVAL
        return self.MIN_INTERVAL
```

- [ ] **Step 4: Create `llm-synthesizer/precedents.py`**

```python
"""Load historical Hormuz incident precedents for LLM context."""
import json
import os

_DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "reference-data", "precedents", "hormuz_incidents.json")


def load_precedents() -> list[dict]:
    with open(_DATA_PATH) as f:
        return json.load(f)


def format_for_prompt(precedents: list[dict]) -> str:
    lines = ["Historical Hormuz incidents and market impact:"]
    for p in precedents:
        lines.append(
            f"- {p['date']} {p['description']}: "
            f"Brent {p['brent_impact_usd']}, WTI {p['wti_impact_pct']}, "
            f"Tankers: {p['tanker_stocks_impact']}"
        )
    return "\n".join(lines)
```

- [ ] **Step 5: Run tests**

```bash
cd llm-synthesizer && python -m pytest tests/test_trigger.py -v
```

Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ..
git add llm-synthesizer/
git commit -m "feat: LLM trigger controller with cost controls and precedents loader"
```

---

### Task 12: Prompt builder and synthesizer service

**Files:**
- Create: `llm-synthesizer/prompt_builder.py`
- Create: `llm-synthesizer/synthesizer.py`
- Create: `llm-synthesizer/tests/test_prompt_builder.py`

- [ ] **Step 1: Write failing tests**

```python
import pytest
from prompt_builder import build_prompt

def test_prompt_contains_risk_score():
    prompt = build_prompt(
        risk_score=72,
        events=[{"type": "DARK_AIS", "severity": "HIGH", "description": "Vessel went dark"}],
        news=[{"headline": "Iran warns shipping", "sentiment": -2}],
        market=[{"symbol": "CL=F", "name": "WTI Crude", "price": 94.20, "change_pct": 3.4}],
        precedents="- 2019 attacks: Brent +$10",
    )
    assert "72" in prompt
    assert "DARK_AIS" in prompt
    assert "Iran warns shipping" in prompt
    assert "WTI Crude" in prompt
    assert "2019 attacks" in prompt

def test_prompt_requests_json_output():
    prompt = build_prompt(72, [], [], [], "")
    assert "JSON" in prompt or "json" in prompt

def test_prompt_is_string():
    prompt = build_prompt(50, [], [], [], "")
    assert isinstance(prompt, str)
    assert len(prompt) > 100
```

- [ ] **Step 2: Create `llm-synthesizer/prompt_builder.py`**

```python
"""Assemble the context window sent to Claude."""
import json


SYSTEM_PROMPT = """You are a maritime intelligence analyst specializing in geopolitical risk in the Strait of Hormuz.
You provide concise, authoritative situation reports that connect vessel activity to market implications.
Your tone is direct and precise — like a briefing for a senior trader or analyst.
Always ground your market outlook in the historical precedents provided."""


def build_prompt(risk_score: int, events: list[dict], news: list[dict],
                 market: list[dict], precedents: str) -> str:
    events_text = "\n".join(
        f"- [{e.get('severity','?')}] {e.get('type','?')}: {e.get('description','')}"
        for e in events[-10:]
    ) or "No significant events in last window."

    news_text = "\n".join(
        f"- [{'+' if n.get('sentiment',0) >= 0 else '-'}{abs(n.get('sentiment',0))}] {n.get('headline','')}"
        for n in news[-5:]
    ) or "No relevant news."

    market_text = "\n".join(
        f"- {m['name']} ({m['symbol']}): ${m['price']} ({'+' if m['change_pct'] >= 0 else ''}{m['change_pct']}%)"
        for m in market
    ) or "No market data."

    return f"""{SYSTEM_PROMPT}

Current composite risk score: {risk_score}/100

ACTIVE INTELLIGENCE EVENTS:
{events_text}

RECENT NEWS (sentiment: - = escalatory, + = de-escalatory):
{news_text}

MARKET SNAPSHOT:
{market_text}

{precedents}

Generate a situation report as valid JSON with exactly these fields:
{{
  "headline": "one sentence, punchy, under 15 words",
  "body": "3-5 sentences analyst briefing",
  "risk_score": {risk_score},
  "key_drivers": ["driver1", "driver2", "driver3"],
  "market_outlook": "1-2 sentences on commodity/equity implications citing precedents where relevant",
  "confidence": "LOW|MEDIUM|HIGH"
}}

Respond with only the JSON object, no markdown fences."""
```

- [ ] **Step 3: Create `llm-synthesizer/synthesizer.py`**

```python
"""LLM Synthesizer — consumes intelligence-events, produces briefings via Claude."""
import json
import logging
import os
import time
from datetime import datetime, timezone

import anthropic
from dotenv import load_dotenv
from kafka_utils import make_producer, make_consumer
from trigger import TriggerController
from prompt_builder import build_prompt
from precedents import load_precedents, format_for_prompt

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

INPUT_TOPIC = "intelligence-events"
OUTPUT_TOPIC = "briefings"
MARKET_TOPIC = "market-ticks"
NEWS_TOPIC = "news-events"


class Synthesizer:
    def __init__(self):
        self.client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        self.producer = make_producer()
        self.trigger = TriggerController()
        self.risk_score = 5
        self.recent_events: list[dict] = []
        self.recent_news: list[dict] = []
        self.market_snapshot: dict[str, dict] = {}
        self.precedents_text = format_for_prompt(load_precedents())

    def ingest_event(self, event: dict):
        self.recent_events.append(event)
        if len(self.recent_events) > 50:
            self.recent_events.pop(0)
        self.risk_score = min(100, self.risk_score + event.get("scoreContribution", 0))
        # Decay: apply gentle decay each event ingestion
        self.risk_score = max(5, int(self.risk_score * 0.98))

    def ingest_news(self, news: dict):
        self.recent_news.append(news)
        if len(self.recent_news) > 20:
            self.recent_news.pop(0)

    def ingest_market(self, tick: dict):
        self.market_snapshot[tick["symbol"]] = tick

    def call_claude(self) -> dict | None:
        model = self.trigger.get_model(self.risk_score)
        prompt = build_prompt(
            self.risk_score,
            self.recent_events,
            self.recent_news,
            list(self.market_snapshot.values()),
            self.precedents_text,
        )
        try:
            resp = self.client.messages.create(
                model=model,
                max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text
            briefing = json.loads(raw)
            briefing["generated_at"] = datetime.now(timezone.utc).isoformat()
            briefing["model_used"] = model
            return briefing
        except Exception as e:
            log.error(f"Claude call failed: {e}")
            return None

    def run(self):
        consumer = make_consumer([INPUT_TOPIC, MARKET_TOPIC, NEWS_TOPIC], "llm-synthesizer")
        log.info("LLM Synthesizer started.")
        last_score = self.risk_score
        for msg in consumer:
            topic = msg.topic
            value = msg.value
            if topic == INPUT_TOPIC:
                self.ingest_event(value)
                if self.trigger.should_trigger(value, self.risk_score, last_score):
                    briefing = self.call_claude()
                    if briefing:
                        self.producer.send(OUTPUT_TOPIC, briefing)
                        log.info(f"Briefing published. Risk: {self.risk_score}. Model: {briefing['model_used']}")
                        self.trigger.record_call(self.risk_score)
                        last_score = self.risk_score
            elif topic == NEWS_TOPIC:
                self.ingest_news(value)
            elif topic == MARKET_TOPIC:
                self.ingest_market(value)


if __name__ == "__main__":
    Synthesizer().run()
```

- [ ] **Step 4: Run prompt builder tests**

```bash
cd llm-synthesizer && python -m pytest tests/ -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd ..
git add llm-synthesizer/
git commit -m "feat: LLM synthesizer with prompt builder and Claude integration"
```

---

## Phase 5: Backend API

### Task 13: FastAPI backend with SSE streaming

**Files:**
- Create: `backend/state.py`
- Create: `backend/api.py`
- Create: `backend/tests/test_api.py`

- [ ] **Step 1: Write failing tests**

```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

# Patch Kafka before importing api
with patch("kafka_utils.make_consumer"), patch("kafka_utils.make_producer"):
    from api import app

client = TestClient(app)

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

def test_vessels_returns_list():
    resp = client.get("/api/vessels")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

def test_briefing_returns_none_when_empty():
    resp = client.get("/api/briefing")
    assert resp.status_code == 200
    data = resp.json()
    assert data is None or isinstance(data, dict)

def test_market_returns_dict():
    resp = client.get("/api/market")
    assert resp.status_code == 200
    assert isinstance(resp.json(), dict)

def test_risk_returns_score():
    resp = client.get("/api/risk")
    assert resp.status_code == 200
    data = resp.json()
    assert "score" in data
    assert 0 <= data["score"] <= 100
```

- [ ] **Step 2: Create `backend/state.py`**

```python
"""In-memory state store for all live data."""
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
import time


@dataclass
class AppState:
    vessels: dict = field(default_factory=dict)          # mmsi → position dict
    market: dict = field(default_factory=dict)           # symbol → tick dict
    briefing: dict | None = None
    events: deque = field(default_factory=lambda: deque(maxlen=200))
    risk_score: int = 5
    _lock: Lock = field(default_factory=Lock)

    VESSEL_TTL = 6 * 3600  # 6 hours

    def update_vessel(self, pos: dict):
        with self._lock:
            pos["_ts"] = time.time()
            self.vessels[pos["mmsi"]] = pos

    def get_vessels(self, min_lat=None, max_lat=None, min_lon=None, max_lon=None) -> list:
        now = time.time()
        with self._lock:
            vessels = [v for v in self.vessels.values() if now - v.get("_ts", 0) < self.VESSEL_TTL]
        if min_lat is not None:
            vessels = [v for v in vessels
                       if min_lat <= v["lat"] <= max_lat and min_lon <= v["lon"] <= max_lon]
        return vessels

    def update_market(self, tick: dict):
        with self._lock:
            self.market[tick["symbol"]] = tick

    def set_briefing(self, briefing: dict):
        with self._lock:
            self.briefing = briefing
            self.risk_score = briefing.get("risk_score", self.risk_score)

    def add_event(self, event: dict):
        with self._lock:
            self.events.appendleft(event)


state = AppState()
```

- [ ] **Step 3: Create `backend/api.py`**

```python
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
```

- [ ] **Step 4: Run tests**

```bash
cd backend && pip install -r requirements.txt -q && python -m pytest tests/test_api.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ..
git add backend/
git commit -m "feat: FastAPI backend with SSE streaming and in-memory state"
```

---

## Phase 6: Frontend

### Task 14: Vite + React + Tailwind setup and design system

**Files:**
- Create: `frontend/` (via Vite scaffold)
- Create: `frontend/src/design.css`
- Create: `frontend/tailwind.config.js`

- [ ] **Step 1: Scaffold Vite + React project**

```bash
cd frontend
npm create vite@latest . -- --template react
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install mapbox-gl lucide-react
```

- [ ] **Step 2: Configure `frontend/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#060a0f",
        surface:  "#071520",
        border:   "#0f2a40",
        primary:  "#00d4ff",
        dimtext:  "#94a3b8",
        bright:   "#e2e8f0",
        critical: "#ef4444",
        high:     "#f97316",
        medium:   "#f59e0b",
        low:      "#22c55e",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 3: Replace `frontend/src/index.css`** with design system

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

* { box-sizing: border-box; }
body { background: #060a0f; color: #94a3b8; font-family: 'Inter', system-ui, sans-serif; margin: 0; }

.glow-primary { box-shadow: 0 0 8px #00d4ff88; }
.glow-critical { box-shadow: 0 0 10px #ef444488; }
.glow-medium   { box-shadow: 0 0 8px #f59e0b88; }

.live-dot { width: 6px; height: 6px; border-radius: 50%; background: #00d4ff;
  box-shadow: 0 0 6px #00d4ff; animation: pulse-dot 2s infinite; }
@keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

.severity-critical { color: #ef4444; }
.severity-high     { color: #f97316; }
.severity-medium   { color: #f59e0b; }
.severity-low      { color: #22c55e; }

.panel { background: #071520; border: 1px solid #0f2a40; border-radius: 6px; padding: 12px; }
.panel-label { font-family: 'JetBrains Mono', monospace; font-size: 9px;
  letter-spacing: 2px; color: #00d4ff; text-transform: uppercase; margin-bottom: 8px; }
```

- [ ] **Step 4: Verify dev server starts**

```bash
cd frontend && npm run dev
```

Expected: Vite server running at `http://localhost:5173`

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/
git commit -m "feat: frontend scaffold with Vite, React, Tailwind, cyber ops design system"
```

---

### Task 15: SSE hooks

**Files:**
- Create: `frontend/src/hooks/useVesselStream.js`
- Create: `frontend/src/hooks/useBriefingStream.js`
- Create: `frontend/src/hooks/useMarketStream.js`

- [ ] **Step 1: Create `frontend/src/hooks/useVesselStream.js`**

```js
import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function useVesselStream() {
  const [vessels, setVessels] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${API}/stream/vessels`);
      esRef.current = es;
      es.onmessage = (e) => {
        try { setVessels(JSON.parse(e.data)); } catch {}
      };
      es.onerror = () => {
        es.close();
        setTimeout(connect, 5000); // reconnect after 5s
      };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  return vessels;
}
```

- [ ] **Step 2: Create `frontend/src/hooks/useBriefingStream.js`**

```js
import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function useBriefingStream() {
  const [briefing, setBriefing] = useState(null);
  const esRef = useRef(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${API}/stream/briefing`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data) setBriefing(data);
        } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  return briefing;
}
```

- [ ] **Step 3: Create `frontend/src/hooks/useMarketStream.js`**

```js
import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function useMarketStream() {
  const [market, setMarket] = useState({});

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`${API}/api/market`);
        if (res.ok) setMarket(await res.json());
      } catch {}
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, []);

  return market;
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/
git commit -m "feat: SSE hooks for vessels, briefing, and market data"
```

---

### Task 16: Header component

**Files:**
- Create: `frontend/src/components/Header.jsx`

- [ ] **Step 1: Create `frontend/src/components/Header.jsx`**

```jsx
import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const LEVEL_COLORS = {
  CRITICAL: "text-critical",
  HIGH: "text-high",
  ELEVATED: "text-medium",
  LOW: "text-low",
};

const LEVEL_BAR_COLORS = {
  CRITICAL: "bg-critical",
  HIGH: "bg-high",
  ELEVATED: "bg-medium",
  LOW: "bg-low",
};

export function Header() {
  const [risk, setRisk] = useState({ score: 5, level: "LOW" });
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    async function fetchRisk() {
      try {
        const res = await fetch(`${API}/api/risk`);
        if (res.ok) setRisk(await res.json());
      } catch {}
    }
    fetchRisk();
    const ri = setInterval(fetchRisk, 10_000);
    const ti = setInterval(() => setTime(new Date()), 1000);
    return () => { clearInterval(ri); clearInterval(ti); };
  }, []);

  const barColor = LEVEL_BAR_COLORS[risk.level] || "bg-low";
  const textColor = LEVEL_COLORS[risk.level] || "text-low";

  return (
    <header className="flex items-center gap-4 px-4 py-2 border-b border-border bg-surface">
      <div className="flex items-center gap-2">
        <span className="text-primary font-mono font-bold text-sm tracking-widest">⚓ HORMUZWATCH</span>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="live-dot" />
        <span className="font-mono text-xs text-primary tracking-widest">LIVE</span>
      </div>

      <div className="flex items-center gap-2 ml-4">
        <span className="font-mono text-xs text-dimtext">THREAT</span>
        <div className="w-32 h-2 bg-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
            style={{ width: `${risk.score}%` }}
          />
        </div>
        <span className={`font-mono text-xs font-bold ${textColor}`}>
          {risk.level} {risk.score}/100
        </span>
      </div>

      <div className="ml-auto font-mono text-xs text-dimtext">
        {time.toUTCString().slice(17, 25)} UTC
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Header.jsx
git commit -m "feat: Header component with threat level bar"
```

---

### Task 17: Map component

**Files:**
- Create: `frontend/src/components/Map.jsx`
- Copy + modify: `frontend/src/utils/geo.js` (from AISGuardian)

- [ ] **Step 1: Copy geo utils from AISGuardian**

```bash
cp /Users/Jaime/claude-personal/aiven-kafka-challenge/frontend/src/utils/geo.js \
   frontend/src/utils/geo.js
```

- [ ] **Step 2: Create `frontend/src/components/Map.jsx`**

```jsx
import { useEffect, useRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const VESSEL_COLORS = {
  tanker:   "#f97316",
  military: "#ef4444",
  cargo:    "#7c3aed",
  lng:      "#06b6d4",
  other:    "#64748b",
};

function vesselCategory(shipType) {
  if (shipType >= 80 && shipType <= 89) return "tanker";
  if (shipType === 35 || shipType === 36) return "military";
  if (shipType >= 70 && shipType <= 79) return "cargo";
  if (shipType === 84 || shipType === 85) return "lng";
  return "other";
}

function drawVesselIcon(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 20; canvas.height = 20;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(10, 2); ctx.lineTo(16, 16); ctx.lineTo(10, 13); ctx.lineTo(4, 16);
  ctx.closePath(); ctx.fill();
  return canvas;
}

export function Map({ vessels, onVesselClick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [56.3, 26.5],   // Strait of Hormuz
      zoom: 7,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Tanker lane overlay
      map.addSource("tanker-lanes", {
        type: "geojson",
        data: "/reference-data/geofences/tanker_lanes.geojson",
      });
      map.addLayer({
        id: "tanker-lanes",
        type: "line",
        source: "tanker-lanes",
        paint: { "line-color": "#00d4ff", "line-width": 1, "line-opacity": 0.4, "line-dasharray": [4, 2] },
      });

      // Register vessel icons
      Object.entries(VESSEL_COLORS).forEach(([cat, color]) => {
        map.addImage(`vessel-${cat}`, { data: drawVesselIcon(color), width: 20, height: 20 });
      });

      // Vessel GeoJSON source (updated dynamically)
      map.addSource("vessels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "vessels",
        type: "symbol",
        source: "vessels",
        layout: {
          "icon-image": ["concat", "vessel-", ["get", "category"]],
          "icon-size": 1,
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
        },
      });

      map.on("click", "vessels", (e) => {
        const props = e.features[0]?.properties;
        if (props && onVesselClick) onVesselClick(props);
      });
      map.on("mouseenter", "vessels", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "vessels", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => map.remove();
  }, []);

  // Update vessel source when vessels prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("vessels");
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: vessels.map((v) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lon, v.lat] },
        properties: {
          mmsi: v.mmsi, name: v.name, speed: v.speed,
          heading: v.heading === 511 ? 0 : v.heading,
          category: vesselCategory(v.shipType || 0),
          shipType: v.shipType,
        },
      })),
    });
  }, [vessels]);

  return <div ref={containerRef} className="w-full h-full" />;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Map.jsx frontend/src/utils/geo.js
git commit -m "feat: Map component with Mapbox GL, vessel icons, tanker lane overlay"
```

---

### Task 18: BriefingPanel, MarketPanel, and IntelFeed components

**Files:**
- Create: `frontend/src/components/BriefingPanel.jsx`
- Create: `frontend/src/components/MarketPanel.jsx`
- Create: `frontend/src/components/IntelFeed.jsx`

- [ ] **Step 1: Create `frontend/src/components/BriefingPanel.jsx`**

```jsx
import { formatDistanceToNow } from "date-fns";

function ConfidenceBadge({ confidence }) {
  const colors = { HIGH: "text-low", MEDIUM: "text-medium", LOW: "text-high" };
  return <span className={`font-mono text-xs ${colors[confidence] || "text-dimtext"}`}>{confidence}</span>;
}

export function BriefingPanel({ briefing }) {
  if (!briefing) {
    return (
      <div className="panel flex flex-col gap-2">
        <div className="panel-label">// AI Situation Report</div>
        <p className="text-xs text-dimtext italic">Awaiting first intelligence synthesis…</p>
      </div>
    );
  }

  const ago = briefing.generated_at
    ? formatDistanceToNow(new Date(briefing.generated_at), { addSuffix: true })
    : "";

  return (
    <div className="panel flex flex-col gap-3">
      <div className="panel-label">// AI Situation Report</div>
      <p className="text-sm text-bright font-semibold leading-tight">{briefing.headline}</p>
      <p className="text-xs text-dimtext leading-relaxed">{briefing.body}</p>

      {briefing.key_drivers?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {briefing.key_drivers.map((d, i) => (
            <span key={i} className="text-xs bg-border text-primary px-2 py-0.5 rounded font-mono">{d}</span>
          ))}
        </div>
      )}

      {briefing.market_outlook && (
        <div className="border-l-2 border-primary pl-2">
          <p className="text-xs text-dimtext italic">{briefing.market_outlook}</p>
        </div>
      )}

      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-1 text-xs text-dimtext font-mono">
          Confidence: <ConfidenceBadge confidence={briefing.confidence} />
        </div>
        <span className="text-xs text-dimtext font-mono">{ago}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/MarketPanel.jsx`**

```jsx
const PRECEDENTS = [
  { date: "Jun 2019", event: "Tanker Attacks", impact: "Brent +$10" },
  { date: "Jan 2012", event: "Sanctions Threat", impact: "WTI +15%" },
  { date: "Dec 2011", event: "Closure Threat", impact: "Brent +$5" },
  { date: "Sep 2019", event: "Abqaiq Attack", impact: "WTI +15% intraday" },
];

const FEATURED = ["CL=F", "BZ=F", "FRO", "STNG"];

function Tick({ tick }) {
  const up = tick.change_pct >= 0;
  return (
    <div className="flex items-center justify-between py-1 border-b border-border last:border-0">
      <div>
        <span className="font-mono text-xs text-bright">{tick.symbol}</span>
        <span className="text-xs text-dimtext ml-2">{tick.name}</span>
      </div>
      <div className="text-right">
        <span className="font-mono text-sm text-bright">${tick.price}</span>
        <span className={`font-mono text-xs ml-2 ${up ? "text-low" : "text-critical"}`}>
          {up ? "▲" : "▼"} {Math.abs(tick.change_pct)}%
        </span>
      </div>
    </div>
  );
}

export function MarketPanel({ market }) {
  const ticks = FEATURED.map((sym) => market[sym]).filter(Boolean);
  const allTicks = Object.values(market).filter((t) => !FEATURED.includes(t.symbol));

  return (
    <div className="flex flex-col gap-3">
      <div className="panel">
        <div className="panel-label">// Market Signals</div>
        {ticks.length === 0
          ? <p className="text-xs text-dimtext italic">Awaiting market data…</p>
          : ticks.map((t) => <Tick key={t.symbol} tick={t} />)
        }
        {allTicks.map((t) => <Tick key={t.symbol} tick={t} />)}
      </div>

      <div className="panel">
        <div className="panel-label">// Historical Context</div>
        <div className="flex flex-col gap-1.5">
          {PRECEDENTS.map((p) => (
            <div key={p.date} className="flex items-start justify-between">
              <div>
                <span className="font-mono text-xs text-primary">{p.date}</span>
                <span className="text-xs text-dimtext ml-2">{p.event}</span>
              </div>
              <span className="font-mono text-xs text-medium ml-2 whitespace-nowrap">{p.impact}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/components/IntelFeed.jsx`**

```jsx
import { formatDistanceToNow } from "date-fns";
import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const SEV_COLORS = {
  CRITICAL: "severity-critical",
  HIGH: "severity-high",
  MEDIUM: "severity-medium",
  LOW: "severity-low",
};

export function IntelFeed() {
  const [events, setEvents] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${API}/stream/events`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          setEvents((prev) => [ev, ...prev].slice(0, 100));
        } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  return (
    <div className="panel h-full overflow-hidden flex flex-col">
      <div className="panel-label">// Live Intelligence Feed</div>
      <div className="overflow-y-auto flex-1 flex flex-col gap-1">
        {events.length === 0
          ? <p className="text-xs text-dimtext italic">Monitoring…</p>
          : events.map((ev, i) => (
            <div key={i} className="flex gap-2 text-xs py-0.5 border-b border-border last:border-0">
              <span className={`font-mono font-bold w-16 shrink-0 ${SEV_COLORS[ev.severity] || "text-dimtext"}`}>
                {ev.severity}
              </span>
              <span className="font-mono text-primary w-28 shrink-0 truncate">{ev.type}</span>
              <span className="text-dimtext flex-1 truncate">{ev.description}</span>
              <span className="font-mono text-dimtext shrink-0">
                {ev.timestamp ? formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true }) : ""}
              </span>
            </div>
          ))
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Install date-fns**

```bash
cd frontend && npm install date-fns
```

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/components/
git commit -m "feat: BriefingPanel, MarketPanel with precedents, IntelFeed components"
```

---

### Task 19: App.jsx assembly and final integration

**Files:**
- Create: `frontend/src/App.jsx`
- Create: `frontend/.env.example`
- Create: `start.sh`

- [ ] **Step 1: Create `frontend/src/App.jsx`**

```jsx
import { useState } from "react";
import { Header } from "./components/Header";
import { Map } from "./components/Map";
import { BriefingPanel } from "./components/BriefingPanel";
import { MarketPanel } from "./components/MarketPanel";
import { IntelFeed } from "./components/IntelFeed";
import { useVesselStream } from "./hooks/useVesselStream";
import { useBriefingStream } from "./hooks/useBriefingStream";
import { useMarketStream } from "./hooks/useMarketStream";

export default function App() {
  const vessels = useVesselStream();
  const briefing = useBriefingStream();
  const market = useMarketStream();
  const [selectedVessel, setSelectedVessel] = useState(null);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        {/* Map — center, takes most space */}
        <div className="flex-1 relative">
          <Map vessels={vessels} onVesselClick={setSelectedVessel} />
          {selectedVessel && (
            <div className="absolute bottom-4 left-4 panel w-64 z-10">
              <div className="panel-label">// Selected Vessel</div>
              <p className="text-xs text-bright font-semibold">{selectedVessel.name || "Unknown"}</p>
              <p className="text-xs text-dimtext font-mono">MMSI: {selectedVessel.mmsi}</p>
              <p className="text-xs text-dimtext font-mono">Speed: {selectedVessel.speed} kt</p>
              <button
                className="mt-2 text-xs text-dimtext hover:text-primary font-mono"
                onClick={() => setSelectedVessel(null)}
              >
                ✕ dismiss
              </button>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-80 flex flex-col gap-2 p-2 overflow-y-auto border-l border-border">
          <BriefingPanel briefing={briefing} />
          <MarketPanel market={market} />
        </div>
      </div>

      {/* Bottom intel feed */}
      <div className="h-32 border-t border-border p-2">
        <IntelFeed />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `frontend/src/main.jsx`**

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 3: Create `frontend/.env.example`**

```
VITE_MAPBOX_TOKEN=pk.eyJ1...
VITE_API_URL=http://localhost:8000
```

- [ ] **Step 4: Create root `start.sh`**

```bash
#!/usr/bin/env bash
set -e

echo "Starting HormuzWatch services..."

# Load env
set -a && source .env && set +a

# AIS Connector
cd ingestion && python ais_connector.py &
echo "✓ AIS Connector started (PID $!)"

# News + Market Pollers
cd ../news-poller && python news_poller.py &
echo "✓ News Poller started (PID $!)"
python market_poller.py &
echo "✓ Market Poller started (PID $!)"

# LLM Synthesizer
cd ../llm-synthesizer && python synthesizer.py &
echo "✓ LLM Synthesizer started (PID $!)"

# Backend
cd ../backend && uvicorn api:app --host 0.0.0.0 --port 8000 &
echo "✓ Backend API started on :8000 (PID $!)"

# Frontend dev server
cd ../frontend && npm run dev &
echo "✓ Frontend started on :5173 (PID $!)"

echo ""
echo "HormuzWatch running. Open http://localhost:5173"
echo "Press Ctrl+C to stop all services."
wait
```

```bash
chmod +x start.sh
```

- [ ] **Step 5: Smoke test — verify frontend builds without errors**

```bash
cd frontend && npm run build
```

Expected: `dist/` created, no TypeScript/JSX errors.

- [ ] **Step 6: Final commit**

```bash
cd ..
git add frontend/src/App.jsx frontend/src/main.jsx frontend/.env.example start.sh
git commit -m "feat: App.jsx assembly, start.sh orchestration — HormuzWatch complete"
```

---

## Deployment Notes

### Ververica Cloud (Flink)
1. Build JAR: `cd flink-jobs && mvn package -DskipTests`
2. Upload `target/hormuzwatch-flink-1.0.0.jar` to Ververica Cloud
3. Set env vars: `KAFKA_BOOTSTRAP_SERVERS`, `KAFKA_TRUSTSTORE_PATH`, `KAFKA_TRUSTSTORE_PASSWORD`
4. Entry class: `com.hormuzwatch.HormuzWatchJob`

### Railway (Python services)
- Deploy `ingestion/`, `news-poller/`, `llm-synthesizer/`, `backend/` as separate services
- Set all env vars from `.env.example`
- Backend service: `uvicorn api:app --host 0.0.0.0 --port $PORT`

### Vercel (Frontend)
- Root: `frontend/`
- Build: `npm run build`
- Output: `dist/`
- Env: `VITE_MAPBOX_TOKEN`, `VITE_API_URL` (Railway backend URL)
