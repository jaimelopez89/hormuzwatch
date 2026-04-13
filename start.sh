#!/usr/bin/env bash
set -e

# Resolve project root regardless of where script is called from
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting HormuzWatch from $DIR..."

# Load env
set -a && source "$DIR/.env" && set +a

# Use python3 explicitly
PY=$(command -v python3 || command -v python)

# AIS Connector (real-time WebSocket)
(cd "$DIR/ingestion" && $PY ais_connector.py) &
echo "✓ AIS Connector (PID $!)"

# MarineTraffic tile scraper (200-400 vessels every 10 min, requires playwright)
(cd "$DIR/ingestion" && $PY marinetraffic_scraper.py) &
echo "✓ MarineTraffic scraper (PID $!)"

# AISHub REST poller (broader coverage — free signup at aishub.net)
if [ -n "$AISHUB_USERNAME" ]; then
  (cd "$DIR/ingestion" && $PY aishub_poller.py) &
  echo "✓ AISHub poller (PID $!)"
else
  echo "  AISHub poller skipped — add AISHUB_USERNAME to .env for broader vessel coverage"
fi

# News Poller
(cd "$DIR/news-poller" && $PY news_poller.py) &
echo "✓ News Poller (PID $!)"

# Market Poller
(cd "$DIR/news-poller" && $PY market_poller.py) &
echo "✓ Market Poller (PID $!)"

# IMF PortWatch Poller (no API key needed)
(cd "$DIR/news-poller" && $PY portwatch_poller.py) &
echo "✓ PortWatch Poller (PID $!)"

# Polymarket Poller (no API key needed)
(cd "$DIR/news-poller" && $PY polymarket_poller.py) &
echo "✓ Polymarket Poller (PID $!)"

# Kalshi Poller (Iran/Hormuz prediction markets, no API key needed)
(cd "$DIR/news-poller" && $PY kalshi_poller.py) &
echo "✓ Kalshi Poller (PID $!)"

# LLM Synthesizer
(cd "$DIR/llm-synthesizer" && $PY synthesizer.py) &
echo "✓ LLM Synthesizer (PID $!)"

# Backend API
(cd "$DIR/backend" && uvicorn api:app --host 0.0.0.0 --port 8000) &
echo "✓ Backend API on :8000 (PID $!)"

# Frontend dev server
(cd "$DIR/frontend" && npm run dev) &
echo "✓ Frontend on :5173 (PID $!)"

echo ""
echo "HormuzWatch running → http://localhost:5173"
echo ""
echo "  /api/status     — Is Hormuz Open?"
echo "  /api/portwatch  — IMF transit data"
echo "  /rss            — Intelligence feed (RSS)"
echo "  /embed          — Embeddable widget"
echo ""
echo "Press Ctrl+C to stop all services."

# Clean shutdown: SIGTERM all children, wait 3s, then SIGKILL stragglers.
# Using pkill -P $$ kills the direct children (and their children inherit
# SIGTERM if they don't catch it); covers uvicorn workers and playwright/chromium.
cleanup() {
    echo ""
    echo "Stopping all HormuzWatch services..."
    pkill -TERM -P $$ 2>/dev/null
    sleep 3
    pkill -KILL -P $$ 2>/dev/null
    exit 0
}
trap cleanup INT TERM
wait
