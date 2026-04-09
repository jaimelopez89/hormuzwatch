"""AIS WebSocket connector — Strait of Hormuz / Persian Gulf."""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import websockets
from dotenv import load_dotenv

try:
    from kafka_utils import make_producer
except ModuleNotFoundError:
    # kafka_utils lives in ingestion/; only needed at runtime, not for unit tests
    make_producer = None  # type: ignore[assignment]

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Persian Gulf + Strait of Hormuz bounding box
HORMUZ_BBOX = {"min_lat": 22.0, "max_lat": 28.0, "min_lon": 54.0, "max_lon": 62.0}
AIS_WS_URL = "wss://stream.aisstream.io/v0/stream"
TOPIC = "ais-positions"


def is_in_hormuz_bbox(lat: float, lon: float) -> bool:
    b = HORMUZ_BBOX
    return b["min_lat"] <= lat <= b["max_lat"] and b["min_lon"] <= lon <= b["max_lon"]


def parse_position(raw: dict) -> dict | None:
    try:
        meta = raw["MetaData"]
        report = raw["Message"]["PositionReport"]
        lat = report["Latitude"]
        lon = report["Longitude"]
        if not is_in_hormuz_bbox(lat, lon):
            return None
        return {
            "mmsi": meta["MMSI"],
            "name": meta.get("ShipName", "").strip(),
            "lat": lat,
            "lon": lon,
            "speed": report.get("Sog", 0),
            "course": report.get("Cog", 0),
            "heading": report.get("TrueHeading", 511),
            "nav_status": report.get("NavigationalStatus", 15),
            "ship_type": meta.get("ShipType", 0),
            "flag": meta.get("MMSI_CountryCode", ""),
            "timestamp": meta.get("time_utc", datetime.now(timezone.utc).isoformat()),
        }
    except (KeyError, TypeError):
        return None


async def run():
    if make_producer is None:
        raise RuntimeError(
            "kafka_utils is not importable. Run from the ingestion/ directory or install dependencies."
        )
    producer = make_producer()
    api_key = os.environ["AISSTREAM_API_KEY"]
    subscribe_msg = json.dumps({
        "APIKey": api_key,
        "BoundingBoxes": [[
            [HORMUZ_BBOX["min_lat"], HORMUZ_BBOX["min_lon"]],
            [HORMUZ_BBOX["max_lat"], HORMUZ_BBOX["max_lon"]],
        ]],
        "FilterMessageTypes": ["PositionReport"],
    })
    backoff = 1
    try:
        while True:
            try:
                log.info("Connecting to AISStream for Hormuz bbox…")
                async with websockets.connect(AIS_WS_URL) as ws:
                    await ws.send(subscribe_msg)
                    backoff = 1
                    async for raw_msg in ws:
                        try:
                            msg = json.loads(raw_msg)
                        except json.JSONDecodeError:
                            log.warning("Malformed message from AISStream, skipping")
                            continue
                        pos = parse_position(msg)
                        if pos:
                            producer.send(TOPIC, pos)
            except Exception as exc:
                log.warning("AISStream disconnected: %s — reconnecting in %ds", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)
    finally:
        producer.flush()
        producer.close()


if __name__ == "__main__":
    asyncio.run(run())
