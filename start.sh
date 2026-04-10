#!/usr/bin/env bash
set -e

echo "Starting HormuzWatch services..."

# Load env
set -a && source .env && set +a

# AIS Connector (real-time WebSocket)
cd ingestion && python ais_connector.py &
echo "✓ AIS Connector started (PID $!)"

# AISHub REST poller (broader coverage — requires AISHUB_USERNAME in .env)
if [ -n "$AISHUB_USERNAME" ]; then
  python aishub_poller.py &
  echo "✓ AISHub poller started (PID $!)"
else
  echo "  AISHub poller skipped (set AISHUB_USERNAME in .env for broader vessel coverage)"
fi

# News Poller
cd ../news-poller && python news_poller.py &
echo "✓ News Poller started (PID $!)"

# Market Poller (commodity + equity prices)
python market_poller.py &
echo "✓ Market Poller started (PID $!)"

# IMF PortWatch Poller (daily transit counts — no API key needed)
python portwatch_poller.py &
echo "✓ PortWatch Poller started (PID $!)"

# Polymarket Poller (prediction market odds — no API key needed)
python polymarket_poller.py &
echo "✓ Polymarket Poller started (PID $!)"

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
echo ""
echo "API endpoints:"
echo "  /api/status     — unified Is Hormuz Open? status"
echo "  /api/portwatch  — IMF PortWatch transit data"
echo "  /api/polymarket — prediction market odds"
echo "  /embed          — embeddable status badge"
echo ""
echo "Press Ctrl+C to stop all services."
wait
