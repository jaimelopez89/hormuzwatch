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
