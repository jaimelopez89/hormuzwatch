#!/usr/bin/env bash
# Railway production start script.
# All data fetchers (market, polymarket, news, windward, synthesizer) run as
# threads inside the backend process — no Kafka needed, no extra memory.
# Only AISStream runs as a separate process (it needs asyncio).

# Nixpacks venv PATH (non-login shell doesn't source ~/.profile)
export PATH="/opt/venv/bin:$PATH"

DIR="$(cd "$(dirname "$0")" && pwd)"
PY=$(command -v python3 || command -v python)
PORT=${PORT:-8000}

echo "=== HormuzWatch starting on port $PORT ==="
echo "Python: $($PY --version)"

# AISStream connector (separate process — asyncio WebSocket)
(cd "$DIR/ingestion" && exec $PY ais_connector.py) &
echo "✓ AIS Connector (PID $!)"

# Backend API (foreground — includes all data fetcher threads)
echo "✓ Backend API on :$PORT (includes market, polymarket, news, weather, windward, synthesizer)"
exec uvicorn api:app \
  --app-dir "$DIR/backend" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers 1 \
  --log-level info
