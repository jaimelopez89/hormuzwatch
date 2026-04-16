#!/usr/bin/env bash
# Railway production start script.
# Only runs the backend API. Pollers (ingestion, news, market, synthesizer)
# should be added as separate Railway services if needed — running 8+ Python
# processes in a single container OOMs on Railway's default memory.

# Nixpacks installs into /opt/venv but only adds it to ~/.profile (login shell).
# This script runs as non-login, so explicitly put the venv on PATH.
export PATH="/opt/venv/bin:$PATH"

PORT=${PORT:-8000}

echo "=== HormuzWatch API starting on port $PORT ==="
echo "Python: $(which python3) — $(python3 --version)"
echo "Uvicorn: $(which uvicorn)"

exec uvicorn api:app \
  --app-dir /app/backend \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers 1 \
  --log-level info
