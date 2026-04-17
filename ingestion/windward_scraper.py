"""Windward.ai Insights scraper — Hormuz crossing counts + dark activity.

Scrapes https://insights.windward.ai/ for near-real-time strait transit data.
No API key needed. Produces intelligence events (not positions) to Kafka.
"""
import logging
import os
import re
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

INSIGHTS_URL = "https://insights.windward.ai/"
TOPIC = "intelligence-events"
POLL_INTERVAL = 1800  # 30 minutes — page doesn't update faster than that


def scrape_windward() -> dict | None:
    """Scrape Windward Insights page for Hormuz crossing data."""
    try:
        resp = requests.get(INSIGHTS_URL, timeout=30, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        if not resp.ok:
            log.warning("Windward returned %d", resp.status_code)
            return None
        html = resp.text

        result = {}

        # "Data as of {date}"
        date_m = re.search(r"Data as of\s+(\w+ \d+,?\s*\d{4})", html)
        if date_m:
            result["data_date"] = date_m.group(1)

        # Chart labels (7-day window): 'Apr 10', 'Apr 11', etc.
        labels = re.findall(r"'((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+)'", html)
        if labels:
            result["chart_labels"] = labels

        # Inbound/outbound data arrays: data:[12, 15, 8, ...]
        data_arrays = re.findall(r"data:\[([0-9., ]+)\]", html)
        if len(data_arrays) >= 2:
            result["inbound"] = [float(x.strip()) for x in data_arrays[0].split(",") if x.strip()]
            result["outbound"] = [float(x.strip()) for x in data_arrays[1].split(",") if x.strip()]
            if result["inbound"] and result["outbound"]:
                result["latest_total"] = result["inbound"][-1] + result["outbound"][-1]

        # "Vessels in Gulf" count
        vessels_m = re.search(r"(\d[,\d]*)\s*(?:Vessels?\s+in\s+(?:the\s+)?Gulf|vessels?\s+in\s+(?:the\s+)?gulf)", html, re.IGNORECASE)
        if vessels_m:
            result["vessels_in_gulf"] = int(vessels_m.group(1).replace(",", ""))

        # "Dark Activity Events" count
        dark_m = re.search(r"(\d[,\d]*)\s*(?:Dark\s+Activity|dark\s+activity)", html, re.IGNORECASE)
        if dark_m:
            result["dark_activity_events"] = int(dark_m.group(1).replace(",", ""))

        if not result:
            log.warning("Windward: no data extracted from page")
            return None

        log.info("Windward scraped: %s", {k: v for k, v in result.items() if k not in ("chart_labels",)})
        return result
    except Exception as e:
        log.warning("Windward scrape failed: %s", e)
        return None


def to_intel_event(data: dict) -> dict:
    """Convert scraped data to an intelligence event."""
    desc_parts = []
    if data.get("latest_total") is not None:
        desc_parts.append(f"Latest daily crossings: {data['latest_total']:.0f}")
    if data.get("vessels_in_gulf") is not None:
        desc_parts.append(f"Vessels in Gulf: {data['vessels_in_gulf']}")
    if data.get("dark_activity_events") is not None:
        desc_parts.append(f"Dark activity events: {data['dark_activity_events']}")

    return {
        "type": "WINDWARD_INSIGHT",
        "severity": "MEDIUM",
        "description": " | ".join(desc_parts) if desc_parts else "Windward data update",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
        "scoreContribution": 0,
    }


def poll_once(producer) -> bool:
    data = scrape_windward()
    if not data:
        return False
    event = to_intel_event(data)
    producer.send(TOPIC, event)
    return True


def run():
    from kafka_utils import make_producer
    producer = make_producer()
    log.info("Windward scraper started (interval=%ds).", POLL_INTERVAL)
    while True:
        if poll_once(producer):
            log.info("Windward: published intelligence event.")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
