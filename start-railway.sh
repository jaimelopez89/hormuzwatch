#!/usr/bin/env bash
# Railway production start script.
# Lightweight pollers run as background processes; uvicorn in foreground.
# MarineTraffic scraper (Playwright/Chromium ~300MB) is excluded — AISStream
# provides the primary vessel feed. Total memory: ~300MB fits Railway 512MB.

# Nixpacks venv PATH (non-login shell doesn't source ~/.profile)
export PATH="/opt/venv/bin:$PATH"

DIR="$(cd "$(dirname "$0")" && pwd)"
PY=$(command -v python3 || command -v python)
PORT=${PORT:-8000}

echo "=== HormuzWatch starting on port $PORT ==="
echo "Python: $($PY --version)"

# ── Pollers (background, ~40MB each) ────────────────────────────────────────

(cd "$DIR/ingestion" && exec $PY ais_connector.py) &
echo "✓ AIS Connector (PID $!)"

(cd "$DIR/news-poller" && exec $PY news_poller.py) &
echo "✓ News poller (PID $!)"

(cd "$DIR/news-poller" && exec $PY market_poller.py) &
echo "✓ Market poller (PID $!)"

(cd "$DIR/news-poller" && exec $PY portwatch_poller.py) &
echo "✓ PortWatch poller (PID $!)"

(cd "$DIR/news-poller" && exec $PY polymarket_poller.py) &
echo "✓ Polymarket poller (PID $!)"

(cd "$DIR/news-poller" && exec $PY kalshi_poller.py) &
echo "✓ Kalshi poller (PID $!)"

(cd "$DIR/llm-synthesizer" && exec $PY synthesizer.py) &
echo "✓ LLM Synthesizer (PID $!)"

# ── Backend API (foreground — Railway health-checks this port) ───────────────
echo "✓ Backend API on :$PORT"
exec uvicorn api:app \
  --app-dir "$DIR/backend" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers 1 \
  --log-level info
