#!/usr/bin/env bash
# Railway production start script.
# Pollers run in background; uvicorn runs in foreground (Railway monitors it).
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
PY=$(command -v python3 || command -v python)
PORT=${PORT:-8000}

echo "=== HormuzWatch (Railway) starting on port $PORT ==="

# Install Playwright browser if scraper is enabled
if [ "${ENABLE_PLAYWRIGHT_SCRAPER:-false}" = "true" ]; then
  echo "Installing Playwright Chromium..."
  playwright install chromium --with-deps 2>/dev/null || true
fi

# ── Pollers (background) ────────────────────────────────────────────────────

(cd "$DIR/ingestion" && $PY ais_connector.py) &
echo "✓ AIS Connector"

if [ "${ENABLE_PLAYWRIGHT_SCRAPER:-false}" = "true" ]; then
  (cd "$DIR/ingestion" && $PY marinetraffic_scraper.py) &
  echo "✓ MarineTraffic scraper"
else
  echo "  MarineTraffic scraper disabled (set ENABLE_PLAYWRIGHT_SCRAPER=true to enable)"
fi

(cd "$DIR/news-poller" && $PY news_poller.py) &
echo "✓ News poller"

(cd "$DIR/news-poller" && $PY market_poller.py) &
echo "✓ Market poller"

(cd "$DIR/news-poller" && $PY portwatch_poller.py) &
echo "✓ PortWatch poller"

(cd "$DIR/news-poller" && $PY polymarket_poller.py) &
echo "✓ Polymarket poller"

(cd "$DIR/news-poller" && $PY kalshi_poller.py) &
echo "✓ Kalshi poller"

(cd "$DIR/llm-synthesizer" && $PY synthesizer.py) &
echo "✓ LLM Synthesizer"

# ── Backend API (foreground — Railway health-checks this port) ───────────────
echo "✓ Backend API on :$PORT"
exec uvicorn api:app \
  --app-dir "$DIR/backend" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers 1
