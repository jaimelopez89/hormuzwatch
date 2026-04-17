"""Datalastic AIS poller — vessel positions via REST API to Kafka.

Free tier: 750 credits on signup (1 credit/vessel per call).
API docs: https://datalastic.com/api-reference/
Requires: DATALASTIC_API_KEY env var.
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

API_URL = "https://api.datalastic.com/api/v0/vessel_find"
TOPIC = "ais-positions"

BBOX = {
    "lat_min": 22.0,
    "lat_max": 28.0,
    "lon_min": 54.0,
    "lon_max": 62.0,
}

# Poll every 30 minutes — conserve the 750 free credits
POLL_INTERVAL = int(os.environ.get("DATALASTIC_POLL_INTERVAL", "1800"))


def fetch_vessels(api_key: str) -> list[dict]:
    resp = requests.get(
        API_URL,
        params={
            "api-key": api_key,
            "lat_min": BBOX["lat_min"],
            "lat_max": BBOX["lat_max"],
            "lon_min": BBOX["lon_min"],
            "lon_max": BBOX["lon_max"],
        },
        timeout=30,
    )
    if resp.status_code == 402:
        log.error("Datalastic: out of credits. Stopping.")
        return []
    if resp.status_code == 429:
        log.warning("Datalastic: rate limited.")
        return []
    resp.raise_for_status()

    data = resp.json()
    vessels = data.get("data", [])
    credits_left = data.get("credits_left", "?")
    log.info("Datalastic: %d vessels fetched (credits remaining: %s).", len(vessels), credits_left)
    return vessels


def to_ais_position(v: dict) -> dict:
    return {
        "mmsi": v.get("mmsi"),
        "name": (v.get("ship_name") or "").strip(),
        "imo": v.get("imo"),
        "lat": v.get("lat") or v.get("latitude"),
        "lon": v.get("lon") or v.get("longitude"),
        "speed": v.get("speed", 0),
        "course": v.get("course", 0),
        "heading": v.get("heading", 511),
        "nav_status": v.get("nav_status", 15),
        "ship_type": v.get("ship_type", 0),
        "flag": v.get("country_iso") or v.get("flag", ""),
        "destination": v.get("destination", ""),
        "timestamp": v.get("last_position_epoch")
            or datetime.now(timezone.utc).isoformat(),
        "_source": "datalastic",
    }


def poll_once(producer) -> int:
    api_key = os.environ.get("DATALASTIC_API_KEY")
    if not api_key:
        return 0

    try:
        vessels = fetch_vessels(api_key)
    except Exception as e:
        log.warning("Datalastic fetch failed: %s", e)
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

    if not os.environ.get("DATALASTIC_API_KEY"):
        log.info("DATALASTIC_API_KEY not set — skipping.")
        return

    producer = make_producer()
    log.info("Datalastic poller started (interval=%ds, bbox=%s).", POLL_INTERVAL, BBOX)
    while True:
        n = poll_once(producer)
        if n:
            log.info("Datalastic: published %d vessel positions.", n)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
