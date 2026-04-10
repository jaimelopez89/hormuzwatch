"""In-memory state store for all live data."""
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
import time


@dataclass
class AppState:
    vessels: dict = field(default_factory=dict)          # mmsi → position dict
    market: dict = field(default_factory=dict)           # symbol → tick dict
    briefing: dict | None = None
    events: deque = field(default_factory=lambda: deque(maxlen=200))
    risk_score: int = 5
    _risk_last_updated: float = field(default_factory=time.time)
    _lock: Lock = field(default_factory=Lock)

    VESSEL_TTL = 6 * 3600          # 6 hours
    RISK_DECAY_PER_HOUR = 5        # score decays 5 pts/hr toward baseline of 5
    RISK_BASELINE = 5

    def update_vessel(self, pos: dict):
        with self._lock:
            if pos.get("_static"):
                # Merge static data into existing vessel record, don't overwrite position
                mmsi = pos["mmsi"]
                if mmsi in self.vessels:
                    for field in ("name", "imo", "destination", "draught", "ship_type", "flag"):
                        if pos.get(field):
                            self.vessels[mmsi][field] = pos[field]
                else:
                    # No position yet — store partial record for later merge
                    pos["_ts"] = time.time()
                    self.vessels[mmsi] = pos
            else:
                mmsi = pos["mmsi"]
                pos["_ts"] = time.time()
                if mmsi in self.vessels:
                    # Preserve enriched fields from static data
                    for field in ("imo", "destination", "draught"):
                        if self.vessels[mmsi].get(field) and not pos.get(field):
                            pos[field] = self.vessels[mmsi][field]
                self.vessels[mmsi] = pos

    def get_vessels(self, min_lat=None, max_lat=None, min_lon=None, max_lon=None) -> list:
        now = time.time()
        with self._lock:
            vessels = [v for v in self.vessels.values() if now - v.get("_ts", 0) < self.VESSEL_TTL]
        if min_lat is not None:
            vessels = [v for v in vessels
                       if min_lat <= v["lat"] <= max_lat and min_lon <= v["lon"] <= max_lon]
        return vessels

    def get_risk(self) -> dict:
        """Return current risk score, applying time-based decay since last event."""
        with self._lock:
            hours_idle = (time.time() - self._risk_last_updated) / 3600
            decayed = max(
                self.RISK_BASELINE,
                self.risk_score - int(hours_idle * self.RISK_DECAY_PER_HOUR),
            )
            return {"score": decayed, "level": _risk_level(decayed)}

    def update_market(self, tick: dict):
        with self._lock:
            self.market[tick["symbol"]] = tick

    def set_briefing(self, briefing: dict):
        with self._lock:
            self.briefing = briefing
            self.risk_score = briefing.get("risk_score", self.risk_score)
            self._risk_last_updated = time.time()

    def add_event(self, event: dict):
        with self._lock:
            self.events.appendleft(event)
            contribution = event.get("scoreContribution", 0)
            if contribution > 0:
                self.risk_score = min(100, self.risk_score + contribution)
                self._risk_last_updated = time.time()

    def stats(self) -> dict:
        now = time.time()
        with self._lock:
            active = sum(1 for v in self.vessels.values() if now - v.get("_ts", 0) < self.VESSEL_TTL)
            tankers = sum(
                1 for v in self.vessels.values()
                if now - v.get("_ts", 0) < self.VESSEL_TTL
                and 80 <= v.get("ship_type", 0) <= 89
            )
            critical = sum(1 for e in self.events if e.get("severity") == "CRITICAL")
            high = sum(1 for e in self.events if e.get("severity") == "HIGH")
        return {"vessels": active, "tankers": tankers, "critical": critical, "high": high}


def _risk_level(score: int) -> str:
    if score >= 80: return "CRITICAL"
    if score >= 60: return "HIGH"
    if score >= 40: return "ELEVATED"
    return "LOW"


state = AppState()
