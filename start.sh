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
