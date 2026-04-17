"""MyShipTracking poller — vessel positions via REST API to Kafka.

Polls the /vessel/zone endpoint for vessels in the Hormuz region.
Fallback source when AISStream has no regional coverage.

API docs: https://api.myshiptracking.com/
Requires: MYSHIPTRACKING_API_KEY env var.
"""
import logging
import os
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

API_BASE = "https://api.myshiptracking.com/api/v2"
TOPIC = "ais-positions"

# Wider bbox to catch traffic approaching the strait — same as SUBSCRIBE_BBOX
BBOX = {
    "minlat": 22.0,
    "maxlat": 28.0,
    "minlon": 54.0,
    "maxlon": 62.0,
}

# Poll every 10 minutes — conservative with credits
# simple response = 1 credit/vessel, ~200 vessels = ~200 credits/poll
POLL_INTERVAL = int(os.environ.get("MST_POLL_INTERVAL", "600"))


def fetch_vessels(api_key: str) -> list[dict]:
    """Fetch vessels in the Hormuz zone via bounding box query."""
    resp = requests.get(
        f"{API_BASE}/vessel/zone",
        params={
            "minlat": BBOX["minlat"],
            "maxlat": BBOX["maxlat"],
            "minlon": BBOX["minlon"],
            "maxlon": BBOX["maxlon"],
            "response": "extended",
            "minutesBack": 60,
        },
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30,
    )
    if resp.status_code == 429:
        log.warning("MyShipTracking: rate limited (429). Backing off.")
        return []
    if resp.status_code == 402:
        log.error("MyShipTracking: out of credits (402). Stopping.")
        return []
    resp.raise_for_status()

    data = resp.json()
    if data.get("status") != "success":
        log.warning("MyShipTracking: unexpected status: %s", data.get("status"))
        return []

    vessels = data.get("data", [])
    if isinstance(vessels, dict):
        vessels = [vessels]

    credits = resp.headers.get("X-Credit-Charged", "?")
    log.info("MyShipTracking: %d vessels fetched (%s credits used).", len(vessels), credits)
    return vessels


def to_ais_position(v: dict) -> dict:
    """Convert MyShipTracking vessel to the same format as ais_connector."""
    return {
        "mmsi": v.get("mmsi"),
        "name": (v.get("vessel_name") or "").strip(),
        "imo": v.get("imo"),
        "lat": v.get("lat"),
        "lon": v.get("lng"),
        "speed": v.get("speed", 0),
        "course": v.get("course", 0),
        "heading": 511,  # not available in simple/extended response
        "nav_status": _parse_nav_status(v.get("nav_status")),
        "ship_type": v.get("ais_type") or v.get("vtype") or 0,
        "flag": v.get("flag", ""),
        "destination": v.get("destination", ""),
        "draught": v.get("draught"),
        "timestamp": v.get("received") or datetime.now(timezone.utc).isoformat(),
        "_source": "myshiptracking",
    }


def _parse_nav_status(raw) -> int:
    """Parse nav_status which may be text or int."""
    if raw is None:
        return 15
    if isinstance(raw, int):
        return raw
    try:
        return int(raw)
    except (ValueError, TypeError):
        return 15


def poll_once(producer) -> int:
    api_key = os.environ.get("MYSHIPTRACKING_API_KEY")
    if not api_key:
        log.warning("MYSHIPTRACKING_API_KEY not set — skipping.")
        return 0

    try:
        vessels = fetch_vessels(api_key)
    except Exception as e:
        log.warning("MyShipTracking fetch failed: %s", e)
        return 0

    sent = 0
    for v in vessels:
        pos = to_ais_position(v)
        if pos["mmsi"] and pos["lat"] and pos["lon"]:
            producer.send(TOPIC, pos)
            sent += 1
    return sent


def run():
    from kafka_utils import make_producer
    producer = make_producer()
    log.info(
        "MyShipTracking poller started (interval=%ds, bbox=%s).",
        POLL_INTERVAL, BBOX,
    )
    while True:
        n = poll_once(producer)
        if n:
            log.info("MyShipTracking: published %d vessel positions.", n)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
