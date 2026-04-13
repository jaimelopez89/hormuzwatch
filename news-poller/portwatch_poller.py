"""
IMF PortWatch poller — fetches daily Strait of Hormuz transit counts.

Source: IMF PortWatch ArcGIS FeatureServer (public, no API key required)
Chokepoint ID: chokepoint6 = Strait of Hormuz
Produces to Kafka topic: portwatch-data

Data has ~4-day lag; poll every 6 hours is sufficient.
"""
import json
import logging
import time
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

ARCGIS_URL = (
    "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services"
    "/Daily_Chokepoints_Data/FeatureServer/0/query"
)
PARAMS = {
    "where": "portid='chokepoint6'",
    "outFields": "*",
    "orderByFields": "date DESC",
    "resultRecordCount": 365,
    "maxRecordCountFactor": 5,
    "f": "json",
}
TOPIC = "portwatch-data"
POLL_INTERVAL = 6 * 3600  # 6 hours


def fetch_portwatch() -> list[dict]:
    resp = requests.get(ARCGIS_URL, params=PARAMS, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    records = []
    for feat in data.get("features", []):
        attrs = feat.get("attributes", {})
        # ArcGIS returns dates as epoch milliseconds
        ts_ms = attrs.get("date")
        date_str = (
            datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            if ts_ms else None
        )
        records.append({
            "date": date_str,
            "n_total":         attrs.get("n_total") or 0,
            "n_tanker":        attrs.get("n_tanker") or 0,
            "n_container":     attrs.get("n_container") or 0,
            "n_dry_bulk":      attrs.get("n_dry_bulk") or 0,
            "n_general_cargo": attrs.get("n_general_cargo") or 0,
            "n_roro":          attrs.get("n_roro") or 0,
        })
    # Sort ascending by date
    records.sort(key=lambda r: r["date"] or "")
    return records


def run():
    from kafka_utils import make_producer
    log.info("PortWatch poller started.")

    # Retry until Kafka is reachable — all services start simultaneously so
    # the first connection attempt can race against broker readiness.
    producer = None
    while producer is None:
        try:
            producer = make_producer()
        except Exception as e:
            log.warning("Kafka connect failed (%s) — retrying in 30s", e)
            time.sleep(30)

    while True:
        try:
            records = fetch_portwatch()
            if records:
                # Compute 90-day average for baseline
                recent = [r["n_total"] for r in records[-90:] if r["n_total"] > 0]
                avg_90 = sum(recent) / len(recent) if recent else 0
                latest = records[-1] if records else {}

                msg = {
                    "source": "imf_portwatch",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "latest_date": latest.get("date"),
                    "latest_total": latest.get("n_total", 0),
                    "latest_tanker": latest.get("n_tanker", 0),
                    "avg_90d": round(avg_90, 1),
                    "pct_of_baseline": round(latest.get("n_total", 0) / avg_90 * 100, 1) if avg_90 else 0,
                    "days": records[-90:],  # last 90 days for charts
                    "all_days": records,    # full 365 days
                }
                producer.send(TOPIC, msg)
                log.info(
                    f"PortWatch: {latest.get('date')} — {latest.get('n_total')} vessels "
                    f"({msg['pct_of_baseline']}% of 90d avg {avg_90:.0f})"
                )
        except Exception as e:
            log.warning(f"PortWatch fetch error: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
