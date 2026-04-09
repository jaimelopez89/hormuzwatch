# HormuzWatch — Website Page Content

> Use this document to create a project page on your website (lopez.fi or similar).
> All sections are ready to copy. Adjust links/screenshots as the project is built.

---

## Page Title

**HormuzWatch** — Real-Time Maritime Intelligence for the Strait of Hormuz

---

## Hero Section

**Headline:**
> The world's oil chokepoint, watched in real time.

**Subheadline:**
> HormuzWatch tracks every vessel, every news event, and every market signal in the Strait of Hormuz — and turns them into live intelligence that matters to your portfolio.

**Live link:** `https://hormuzwatch.lopez.fi` *(update when deployed)*

**CTA button:** View Live Dashboard →

---

## What Is It?

HormuzWatch is an open-source, near-real-time intelligence dashboard monitoring the Strait of Hormuz — the narrow waterway through which roughly 20% of the world's oil supply transits every day.

Built during a period of heightened tensions between the US, Israel, and Iran, HormuzWatch answers three questions simultaneously:

1. **What is happening in the strait right now?** — Live AIS vessel tracking shows every ship, tanker, and naval vessel transiting or loitering.
2. **What does it mean for markets?** — Commodity prices, tanker stocks, and energy equities update in real time alongside a historically-grounded risk model.
3. **What should I think about it?** — An AI briefing engine synthesizes vessel patterns, breaking news, and market moves into a plain-language situation report, updated as events unfold.

---

## Key Features

### Live AIS Vessel Tracking
Hundreds of vessels tracked in real time using AIS (Automatic Identification System) transponder data. Ships are color-coded by type — tankers, cargo, military, LNG carriers — with historical trail lines and heading indicators. Military vessel proximity to tanker lanes is flagged automatically.

### AI Situation Reports
An intelligent briefing engine monitors the stream of AIS anomalies and breaking news. When something significant happens — a vessel goes dark, military ships converge on tanker lanes, a news event correlates with a maritime anomaly — Claude generates a plain-language intelligence briefing within two minutes. Each report cites historical precedents from past Hormuz incidents (2019 tanker attacks, 2012 sanctions threats, 2011 strait closure threat) so the reader immediately understands the market context.

### Market Signals
Live commodity and equity prices, updated every 30 seconds:
- WTI Crude, Brent Crude, Natural Gas futures
- Tanker stocks: Frontline, Scorpio Tankers, DHT Holdings
- Energy majors: ExxonMobil, Chevron, BP
- A composite **Hormuz Closure Risk Index** (0–100) derived from vessel pattern analysis

### Real-Time Anomaly Detection
Six detection algorithms run continuously in Apache Flink:
- **Traffic Volume Anomaly** — unusual drops or surges in vessel count vs. 30-day baseline
- **Military Proximity** — warships approaching tanker lanes
- **Tanker Concentration** — vessels clustering and waiting, suggesting avoidance behavior
- **Dark AIS Events** — transponders switched off inside the strait corridor
- **Slowdown Detection** — tankers abruptly reducing speed in sensitive areas
- **News × AIS Correlation** — when breaking news and maritime anomalies happen simultaneously

### Live Intelligence Feed
A scrolling ticker of intelligence events — vessel anomalies, news headlines, and market moves — gives a live pulse of activity in the region.

---

## Technical Architecture

HormuzWatch is built on the same event-streaming stack as [AISGuardian](https://lopez.fi/aisguardian), my Baltic Sea infrastructure protection system, extended with news ingestion, market data, and an LLM synthesis layer.

```
AIS Data ──┐
News RSS ──┼──► Kafka (Aiven) ──► Flink (Ververica Cloud) ──► LLM Synthesizer ──► Dashboard
Markets ───┘
```

### Stack

| Layer | Technology |
|---|---|
| Message broker | Apache Kafka (Aiven free tier) |
| Stream processing | Apache Flink 1.18 on Ververica Cloud |
| AI narrative | Claude (Anthropic) — Haiku / Sonnet tiered |
| Backend API | FastAPI (Python) with Server-Sent Events |
| Frontend | React 18, Vite, Mapbox GL JS, Tailwind CSS |
| AIS data | AISStream.io WebSocket |
| Market data | Yahoo Finance (yfinance) |
| News data | Reuters, Al Jazeera, AP, USNI News RSS |
| Deployment | Railway (backend), Vercel (frontend), Aiven (Kafka) |

### Intelligent Cost Controls

The LLM synthesis layer uses four-layer cost controls to keep the AI briefing system affordable:

1. **Significance scoring** — only meaningful events (severity ≥ 4/10) ever reach the LLM
2. **Delta-based triggering** — Claude is only called when the risk score changes by ≥ 8 points
3. **Model tiering** — low-risk periods use the cheaper Haiku model; high-risk periods escalate to Sonnet
4. **Hard minimum interval** — maximum two calls per minute, extended to ten minutes overnight

Result: approximately $0.02–$0.15/day in LLM API costs, with briefings still updating within two minutes of any meaningful event.

---

## Design

HormuzWatch uses a **Cyber Ops / OSINT Terminal** aesthetic — electric cyan on deep navy, monospace type for data values, glowing live indicators. The goal is a dashboard that feels like an intelligence analyst's workstation: authoritative, precise, and immediately striking.

The single-page layout keeps the map, AI briefing, and market signals visible simultaneously — no tabs, no navigation, no context switching.

*(Add screenshot here when built)*

---

## Why I Built This

The Strait of Hormuz carries roughly one-fifth of the world's daily oil supply through a passage 33km wide at its narrowest point. Any disruption — an Iranian vessel seizure, a naval confrontation, a strait closure threat — sends commodity markets moving within hours.

I wanted to build a tool that made this connection visible and legible in real time. AISGuardian showed me the power of streaming AIS data through Kafka and Flink for maritime surveillance. HormuzWatch extends that architecture into the economic dimension: what do these vessel movements *mean* for oil prices, tanker stocks, and global supply chains?

The answer, synthesized fresh every few minutes by an AI that has read the same news headlines and market ticks you have, is what this dashboard delivers.

---

## Open Source

Source code: `https://github.com/jaimelopez/hormuzwatch` *(update when published)*

Contributions welcome. See `README.md` for setup instructions.

---

## Related Projects

- **[AISGuardian](https://lopez.fi/aisguardian)** — Maritime surveillance for Baltic Sea critical infrastructure. The predecessor project that established this architecture.

---

*Built by Jaime Lopez · April 2026*
