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
    _lock: Lock = field(default_factory=Lock)

    VESSEL_TTL = 6 * 3600  # 6 hours

    def update_vessel(self, pos: dict):
        with self._lock:
            pos["_ts"] = time.time()
            self.vessels[pos["mmsi"]] = pos

    def get_vessels(self, min_lat=None, max_lat=None, min_lon=None, max_lon=None) -> list:
        now = time.time()
        with self._lock:
            vessels = [v for v in self.vessels.values() if now - v.get("_ts", 0) < self.VESSEL_TTL]
        if min_lat is not None:
            vessels = [v for v in vessels
                       if min_lat <= v["lat"] <= max_lat and min_lon <= v["lon"] <= max_lon]
        return vessels

    def update_market(self, tick: dict):
        with self._lock:
            self.market[tick["symbol"]] = tick

    def set_briefing(self, briefing: dict):
        with self._lock:
            self.briefing = briefing
            self.risk_score = briefing.get("risk_score", self.risk_score)

    def add_event(self, event: dict):
        with self._lock:
            self.events.appendleft(event)


state = AppState()
