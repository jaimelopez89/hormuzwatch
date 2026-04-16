"""AIS WebSocket connector — Strait of Hormuz / Persian Gulf."""
import asyncio
import json
import logging
import os
import ssl
from datetime import datetime, timezone

import certifi
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
    """Parse AIS position report messages (Class A and B)."""
    try:
        meta = raw["MetaData"]
        report = (
            raw["Message"].get("PositionReport")
            or raw["Message"].get("StandardClassBPositionReport")
        )
        if report is None:
            return None
        lat = report.get("Latitude") or meta.get("latitude")
        lon = report.get("Longitude") or meta.get("longitude")
        if lat is None or lon is None:
            return None
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


def parse_static(raw: dict) -> dict | None:
    """Parse AIS Type 5 / 24 static data — ship name, IMO, destination, draught."""
    try:
        meta = raw["MetaData"]
        # StaticDataReport wraps either PartA or PartB
        sd = raw["Message"].get("StaticDataReport") or {}
        part_a = sd.get("ReportA") or {}
        part_b = sd.get("ReportB") or {}
        # Voyage data (Type 5)
        voyage = raw["Message"].get("ShipStaticAndVoyageRelatedData") or {}

        name = (
            part_a.get("ShipName")
            or meta.get("ShipName", "")
        ).strip()
        imo = voyage.get("ImoNumber") or 0
        dest = voyage.get("Destination", "").strip()
        draught = voyage.get("MaximumStaticDraught") or 0
        ship_type = (
            part_b.get("ShipType")
            or voyage.get("TypeOfShipAndCargoType")
            or meta.get("ShipType", 0)
        )

        if not name and not imo:
            return None  # nothing useful

        return {
            "mmsi": meta["MMSI"],
            "name": name,
            "imo": imo,
            "destination": dest,
            "draught": draught,
            "ship_type": ship_type,
            "flag": meta.get("MMSI_CountryCode", ""),
            "_static": True,  # marker so backend can upsert without overwriting position
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
    # Only APIKey + BoundingBoxes — no FilterMessageTypes.
    # AISStream drops connections immediately if it doesn't recognise a filter value.
    # We filter client-side by MessageType instead.
    subscribe_msg = json.dumps({
        "APIKey": api_key,
        "BoundingBoxes": [[
            [HORMUZ_BBOX["min_lat"], HORMUZ_BBOX["min_lon"]],
            [HORMUZ_BBOX["max_lat"], HORMUZ_BBOX["max_lon"]],
        ]],
    })
    log.info("AISStream API key: %s…%s", api_key[:6], api_key[-4:])
    backoff = 5
    consecutive_fast_fails = 0
    try:
        while True:
            connect_time = asyncio.get_event_loop().time()
            try:
                log.info("Connecting to AISStream…")
                ssl_ctx = ssl.create_default_context(cafile=certifi.where())
                async with websockets.connect(
                    AIS_WS_URL, ssl=ssl_ctx,
                    open_timeout=30, close_timeout=10,
                    ping_interval=20, ping_timeout=20,
                ) as ws:
                    await ws.send(subscribe_msg)
                    msgs_received = 0
                    async for raw_msg in ws:
                        try:
                            msg = json.loads(raw_msg)
                        except json.JSONDecodeError:
                            continue
                        msgs_received += 1
                        if msgs_received == 1:
                            log.info("AISStream connected — receiving data.")
                            # First message = connection is real. Reset backoff.
                            backoff = 5
                            consecutive_fast_fails = 0
                        if msgs_received % 500 == 0:
                            log.info("AISStream: %d messages received.", msgs_received)
                        msg_type = msg.get("MessageType", "")
                        if msg_type in ("ShipStaticAndVoyageRelatedData", "StaticDataReport"):
                            static = parse_static(msg)
                            if static:
                                producer.send(TOPIC, static)
                        else:
                            pos = parse_position(msg)
                            if pos:
                                producer.send(TOPIC, pos)
            except Exception as exc:
                elapsed = asyncio.get_event_loop().time() - connect_time
                exc_str = str(exc)
                if "429" in exc_str or "too many requests" in exc_str.lower():
                    backoff = 600
                    log.error("AISStream: HTTP 429 rate limit. Waiting %ds.", backoff)
                elif elapsed < 5:
                    consecutive_fast_fails += 1
                    log.warning(
                        "AISStream fast disconnect (%ds, attempt %d): %s",
                        int(elapsed), consecutive_fast_fails, exc,
                    )
                    # Gentle backoff: 5 → 10 → 20 → 40 → 60 (cap)
                    backoff = min(5 * (2 ** min(consecutive_fast_fails, 4)), 60)
                else:
                    # Connection lasted >5s — was real, just dropped. Quick retry.
                    consecutive_fast_fails = 0
                    backoff = 5
                    log.warning("AISStream disconnected after %ds: %s", int(elapsed), exc)
                log.info("Reconnecting in %ds…", backoff)
                await asyncio.sleep(backoff)
    finally:
        try:
            producer.flush()
            producer.close()
        except Exception as e:
            log.warning("Producer cleanup error (non-fatal): %s", e)


if __name__ == "__main__":
    asyncio.run(run())
