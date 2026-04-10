"""
MarineTraffic tile scraper — Strait of Hormuz vessel positions.

Uses Playwright to scrape MarineTraffic's internal map tile API, the same
technique used by ishormuzopenyet. Returns 200-400 vessels covering the
full Persian Gulf + Strait of Hormuz, including satellite-tracked vessels.

Setup (one-time):
    pip install playwright
    playwright install chromium

Polls every 10 minutes. Publishes to the same 'ais-positions' Kafka topic
as the AISStream connector — the backend deduplicates by MMSI.
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

TOPIC = "ais-positions"
POLL_INTERVAL = 10 * 60  # 10 minutes — be respectful of MT's servers

# Tiles at MT's internal z:8 covering Persian Gulf + Strait of Hormuz
# Verified by ishormuzopenyet to return 200-400 vessels in this area
TILES = [
    {"x": 83, "y": 53},
    {"x": 84, "y": 53},
    {"x": 83, "y": 54},
    {"x": 84, "y": 54},
]

MT_TILE_URL = "https://www.marinetraffic.com/getData/get_data_json_4/z:8/X:{x}/Y:{y}/station:0"
MT_HOME = "https://www.marinetraffic.com/en/ais/home/centerx:56.3/centery:26.5/zoom:8"


async def fetch_tiles() -> list[dict]:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )
        page = await context.new_page()

        # Visit the map first to pick up session cookies and pass bot detection
        try:
            await page.goto(MT_HOME, wait_until="networkidle", timeout=30_000)
            await asyncio.sleep(3)
        except Exception as e:
            log.debug("MT home page visit failed (non-fatal): %s", e)

        all_rows: list[dict] = []
        for tile in TILES:
            url = MT_TILE_URL.format(x=tile["x"], y=tile["y"])
            try:
                # Use response.body() — more reliable than document.body.innerText
                # which is empty when Cloudflare serves a JS challenge page
                response = await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                if response is None:
                    log.warning("Tile (%d,%d): no response", tile["x"], tile["y"])
                    continue
                body = await response.body()
                text = body.decode("utf-8").strip()
                if not text:
                    log.warning("Tile (%d,%d): empty response (status %d)", tile["x"], tile["y"], response.status)
                    continue
                if not text.startswith("{") and not text.startswith("["):
                    log.warning("Tile (%d,%d): non-JSON response (status %d): %s…",
                                tile["x"], tile["y"], response.status, text[:120])
                    continue
                data = json.loads(text)
                if isinstance(data, dict):
                    rows = data.get("data", {}).get("rows", [])
                elif isinstance(data, list):
                    rows = data
                else:
                    rows = []
                all_rows.extend(rows)
                log.info("Tile (%d,%d): %d vessels", tile["x"], tile["y"], len(rows))
                await asyncio.sleep(1)
            except Exception as e:
                log.warning("Tile (%d,%d) failed: %s", tile["x"], tile["y"], e)

        await browser.close()
        return all_rows


def parse_vessel(row: dict) -> dict | None:
    try:
        lat = float(row.get("LAT", 0))
        lon = float(row.get("LON", 0))
        if lat == 0.0 and lon == 0.0:
            return None

        # MT encodes speed as integer * 10
        raw_speed = row.get("SPEED", 0)
        speed = float(raw_speed) / 10 if raw_speed else 0.0

        mmsi = int(row.get("MMSI") or 0)
        if mmsi == 0:
            # Fall back to SHIP_ID if MMSI missing
            mmsi = int(row.get("SHIP_ID") or 0)

        return {
            "mmsi": mmsi,
            "name": str(row.get("SHIPNAME") or row.get("NAME") or "").strip(),
            "lat": lat,
            "lon": lon,
            "speed": speed,
            "course": float(row.get("COURSE") or 0),
            "heading": int(row.get("HEADING") or 511),
            "nav_status": int(row.get("NAVSTAT") or 15),
            "ship_type": int(row.get("TYPE_ID") or row.get("SHIP_TYPE") or 0),
            "flag": str(row.get("FLAG") or ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "_source": "marinetraffic",
        }
    except (ValueError, TypeError) as e:
        log.debug("parse_vessel error: %s — %r", e, row)
        return None


def run():
    from kafka_utils import make_producer
    producer = make_producer()
    log.info("MarineTraffic scraper started (polling every %d min).", POLL_INTERVAL // 60)

    while True:
        try:
            rows = asyncio.run(fetch_tiles())

            seen_mmsi: set[int] = set()
            sent = 0
            for row in rows:
                vessel = parse_vessel(row)
                if vessel and vessel["mmsi"] and vessel["mmsi"] not in seen_mmsi:
                    seen_mmsi.add(vessel["mmsi"])
                    producer.send(TOPIC, vessel)
                    sent += 1

            log.info("MarineTraffic: scraped %d unique vessels from %d tiles.", sent, len(TILES))
        except ImportError:
            log.error(
                "Playwright not installed. Run: pip install playwright && playwright install chromium"
            )
            break
        except Exception as e:
            log.error("MarineTraffic scraper error: %s", e)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
