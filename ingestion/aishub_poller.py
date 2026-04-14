"""
AISHub REST poller — supplements AISStream WebSocket with broader vessel coverage.

AISHub aggregates data from 3000+ shore-based AIS receivers worldwide.
FREE registration at https://www.aishub.net — set AISHUB_USERNAME in .env

Polls every 2 minutes (AISHub throttles faster requests).
Produces to same 'ais-positions' topic as AISStream connector.
"""
import json
import logging
import os
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

TOPIC = "ais-positions"
POLL_INTERVAL = 120  # AISHub rate limit: min 1 req/2min on free tier

# Persian Gulf + Strait of Hormuz
BBOX = {"latmin": 22.0, "latmax": 28.0, "lonmin": 54.0, "lonmax": 62.0}

# Ship type name mapping (ITU codes)
SHIP_TYPE_NAMES = {
    0: "", 20: "WIG", 30: "Fishing", 35: "Military", 36: "Law Enforcement",
    40: "High Speed", 50: "Pilot", 51: "SAR", 52: "Tug",
    60: "Passenger", 70: "Cargo", 80: "Tanker", 84: "LNG Tanker", 90: "Other",
}


def fetch_vessels(username: str) -> list[dict]:
    """Fetch all vessels in Hormuz bbox from AISHub REST API."""
    url = "http://data.aishub.net/ws.php"
    params = {
        "username": username,
        "format": "1",
        "output": "json",
        "compress": "0",
        "latmin": BBOX["latmin"],
        "latmax": BBOX["latmax"],
        "lonmin": BBOX["lonmin"],
        "lonmax": BBOX["lonmax"],
    }
    resp = requests.get(url, params=params, timeout=20)
    resp.raise_for_status()

    # AISHub returns a 2-element array: [metadata, vessels_array]
    data = resp.json()
    if not isinstance(data, list) or len(data) < 2:
        return []
    raw_vessels = data[1]
    if not isinstance(raw_vessels, list):
        return []

    positions = []
    for v in raw_vessels:
        try:
            lat = float(v.get("LATITUDE", 0))
            lon = float(v.get("LONGITUDE", 0))
            positions.append({
                "mmsi": int(v.get("MMSI", 0)),
                "name": str(v.get("NAME", "")).strip(),
                "lat": lat,
                "lon": lon,
                "speed": float(v.get("SOG", 0)),
                "course": float(v.get("COG", 0)),
                "heading": int(v.get("HEADING", 511)),
                "nav_status": int(v.get("NAVSTAT", 15)),
                "ship_type": int(v.get("TYPE", 0)),
                "flag": str(v.get("FLAG", "")),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "_source": "aishub",
            })
        except (ValueError, TypeError):
            continue
    return positions


def run():
    username = os.environ.get("AISHUB_USERNAME")
    if not username:
        log.warning(
            "AISHUB_USERNAME not set. Register free at https://www.aishub.net "
            "and add AISHUB_USERNAME=<your_username> to .env. AISHub poller disabled."
        )
        return

    from kafka_utils import make_producer
    producer = make_producer()
    log.info(f"AISHub poller started (user: {username})")

    while True:
        try:
            vessels = fetch_vessels(username)
            for v in vessels:
                producer.send(TOPIC, v)
            log.info(f"AISHub: {len(vessels)} vessels in Hormuz bbox")
        except Exception as e:
            log.warning(f"AISHub error: {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
