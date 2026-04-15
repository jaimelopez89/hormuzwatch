"""
weather_poller.py — Fetches ECMWF maritime weather for the Strait of Hormuz
via Open-Meteo (no API key required, non-commercial use).

Polls two endpoints:
  - Open-Meteo forecast API  → wind speed/direction/gusts at 10 m (knots)
  - Open-Meteo marine API    → significant wave height, wave direction

Strait centroid: 26.5°N, 56.3°E (centre of the Hormuz narrows)

Runs every POLL_INTERVAL_S seconds (default 3 hours). Updates shared AppState
so the backend can expose it via /api/weather and factor it into the risk score.
"""

import logging
import time
import urllib.request
import json

log = logging.getLogger(__name__)

STRAIT_LAT = 26.5
STRAIT_LON = 56.3
POLL_INTERVAL_S = 3 * 3600   # 3 hours

# Open-Meteo endpoints — no key required
_WIND_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={STRAIT_LAT}&longitude={STRAIT_LON}"
    "&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m"
    "&wind_speed_unit=kn"
    "&timezone=UTC"
    "&forecast_days=2"
    "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m"
)

_MARINE_URL = (
    "https://marine-api.open-meteo.com/v1/marine"
    f"?latitude={STRAIT_LAT}&longitude={STRAIT_LON}"
    "&current=wave_height,wave_direction,wind_wave_height"
    "&hourly=wave_height,wind_wave_height"
    "&forecast_days=2"
    "&timezone=UTC"
)


def _fetch(url: str) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HormuzWatch/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        log.warning("weather_poller: fetch error for %s — %s", url, exc)
        return None


def _beaufort(speed_kt: float) -> tuple[int, str]:
    """Return Beaufort number and label from speed in knots."""
    thresholds = [
        (1,  "Calm"),
        (3,  "Light air"),
        (6,  "Light breeze"),
        (10, "Gentle breeze"),
        (16, "Moderate breeze"),
        (21, "Fresh breeze"),
        (27, "Strong breeze"),
        (33, "Near gale"),
        (40, "Gale"),
        (47, "Strong gale"),
        (55, "Storm"),
        (63, "Violent storm"),
    ]
    for max_kt, label in thresholds:
        if speed_kt < max_kt:
            return thresholds.index((max_kt, label)), label
    return 12, "Hurricane"


def _transit_risk_modifier(wind_kt: float, gusts_kt: float, wave_m: float) -> int:
    """
    Returns an additive risk score modifier (0–30) based on maritime conditions.
    Beaufort 7+ (>28 kt) or waves >2.5 m significantly affect VLCC maneuvering
    in the Hormuz narrows.
    """
    score = 0
    if wind_kt >= 35:
        score += 20
    elif wind_kt >= 28:
        score += 10
    elif wind_kt >= 22:
        score += 4
    if wave_m >= 3.0:
        score += 15
    elif wave_m >= 2.5:
        score += 8
    elif wave_m >= 1.5:
        score += 3
    if gusts_kt >= 45:
        score += 5
    return min(score, 30)


def _direction_label(deg: float) -> str:
    dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
            "S","SSW","SW","WSW","W","WNW","NW","NNW"]
    return dirs[round(deg / 22.5) % 16]


def poll_once(state) -> dict | None:
    """Fetch weather, update state, return the new weather dict or None on failure."""
    wind_data   = _fetch(_WIND_URL)
    marine_data = _fetch(_MARINE_URL)

    if not wind_data or not marine_data:
        return None

    try:
        wc = wind_data.get("current", {})
        mc = marine_data.get("current", {})

        wind_kt   = round(wc.get("wind_speed_10m", 0) or 0, 1)
        gusts_kt  = round(wc.get("wind_gusts_10m", 0) or 0, 1)
        wind_dir  = round(wc.get("wind_direction_10m", 0) or 0)
        wave_m    = round(mc.get("wave_height", 0) or 0, 2)
        wave_dir  = round(mc.get("wave_direction", 0) or 0)

        bft_num, bft_label = _beaufort(wind_kt)
        risk_mod = _transit_risk_modifier(wind_kt, gusts_kt, wave_m)

        # Build 24-h hourly forecast arrays (wind + waves)
        wh = wind_data.get("hourly", {})
        mh = marine_data.get("hourly", {})
        times    = wh.get("time", [])[:24]
        winds_fc = [round(v or 0, 1) for v in wh.get("wind_speed_10m", [])[:24]]
        gusts_fc = [round(v or 0, 1) for v in wh.get("wind_gusts_10m", [])[:24]]
        waves_fc = [round(v or 0, 2) for v in mh.get("wave_height", [])[:24]]

        weather = {
            "wind_kt":      wind_kt,
            "gusts_kt":     gusts_kt,
            "wind_dir":     wind_dir,
            "wind_dir_label": _direction_label(wind_dir),
            "wave_m":       wave_m,
            "wave_dir":     wave_dir,
            "wave_dir_label": _direction_label(wave_dir),
            "beaufort":     bft_num,
            "beaufort_label": bft_label,
            "risk_modifier": risk_mod,
            "forecast": [
                {"time": t, "wind_kt": w, "gusts_kt": g, "wave_m": wv}
                for t, w, g, wv in zip(times, winds_fc, gusts_fc, waves_fc)
            ],
            "updated_utc":  wc.get("time", ""),
            "source":       "ECMWF via Open-Meteo (non-commercial)",
        }

        state.update_weather(weather)
        log.info(
            "weather_poller: wind %.1f kt (gusts %.1f kt) %s, wave %.2f m — "
            "Beaufort %d (%s), risk modifier +%d",
            wind_kt, gusts_kt, _direction_label(wind_dir),
            wave_m, bft_num, bft_label, risk_mod,
        )
        return weather

    except Exception as exc:
        log.error("weather_poller: parse error — %s", exc)
        return None


def run(state):
    """Background thread entry point. Polls indefinitely."""
    log.info("weather_poller: started (ECMWF via Open-Meteo, strait centroid %.1f°N %.1f°E)",
             STRAIT_LAT, STRAIT_LON)
    while True:
        poll_once(state)
        time.sleep(POLL_INTERVAL_S)
