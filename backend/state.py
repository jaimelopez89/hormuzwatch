"""In-memory state store for all live data."""
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
import time


def _risk_level(score: int) -> str:
    if score >= 80: return "CRITICAL"
    if score >= 60: return "HIGH"
    if score >= 40: return "ELEVATED"
    return "LOW"


@dataclass
class AppState:
    vessels: dict = field(default_factory=dict)          # mmsi → position dict
    market: dict = field(default_factory=dict)           # symbol → tick dict
    briefing: dict | None = None
    events: deque = field(default_factory=lambda: deque(maxlen=500))
    risk_score: int = 5
    _risk_last_updated: float = field(default_factory=time.time)
    _lock: Lock = field(default_factory=Lock)

    # IMF PortWatch data
    portwatch: dict | None = None  # latest portwatch message with .days, .all_days, etc.

    # Polymarket prediction markets (symbol → tick with yes_probability)
    polymarkets: dict = field(default_factory=dict)

    # Risk score history — one snapshot every 5 min, 24h window
    risk_history: deque = field(default_factory=lambda: deque(maxlen=288))

    # Heatmap cells — cellId → HeatmapCell dict
    heatmap: dict = field(default_factory=dict)

    # Vessel trajectory predictions — mmsi → TrajectoryPrediction dict
    predictions: dict = field(default_factory=dict)

    # Fleet graph edges — "mmsi1:mmsi2" → FleetEdge dict
    fleet_graph: dict = field(default_factory=dict)

    # Throughput snapshots — date → ThroughputSnapshot dict
    throughput: dict = field(default_factory=dict)

    # Analyst-defined geofences — id → GeofenceDefinition dict
    geofences: dict = field(default_factory=dict)

    # Service health tracking
    _source_last_seen: dict = field(default_factory=dict)  # source_name → timestamp

    # Daily transit counter (our own vessel tracking)
    daily_transits: dict = field(default_factory=dict)  # date → set of mmsis

    VESSEL_TTL = 8 * 3600          # 8 hours — keep vessels longer for better coverage
    RISK_DECAY_PER_HOUR = 15       # score decays 15 pts/hr — resets to baseline in ~6h
    RISK_BASELINE = 5

    def update_vessel(self, pos: dict):
        with self._lock:
            if pos.get("_static"):
                # Merge static data into existing vessel record
                mmsi = pos["mmsi"]
                if mmsi in self.vessels:
                    for f in ("name", "imo", "destination", "draught", "ship_type", "flag"):
                        if pos.get(f):
                            self.vessels[mmsi][f] = pos[f]
                else:
                    pos["_ts"] = time.time()
                    self.vessels[mmsi] = pos
            else:
                mmsi = pos["mmsi"]
                pos["_ts"] = time.time()
                if mmsi in self.vessels:
                    for f in ("imo", "destination", "draught"):
                        if self.vessels[mmsi].get(f) and not pos.get(f):
                            pos[f] = self.vessels[mmsi][f]
                self.vessels[mmsi] = pos

                # Count toward today's transit tally
                today = time.strftime("%Y-%m-%d", time.gmtime())
                if today not in self.daily_transits:
                    self.daily_transits[today] = set()
                self.daily_transits[today].add(mmsi)

                # Prune old days (keep 30)
                if len(self.daily_transits) > 30:
                    oldest = sorted(self.daily_transits)[0]
                    del self.daily_transits[oldest]

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

    def get_status(self) -> dict:
        """
        Unified 'Is Hormuz Open?' determination.
        Primary authority: IMF PortWatch (most reliable, objective)
        Secondary: Polymarket prediction markets
        Tertiary: Risk score (soft signal, recency-weighted)
        """
        risk = self.get_risk()

        # PortWatch signal — primary, most authoritative
        pw_signal = None
        pw_pct = None
        if self.portwatch:
            pw_pct = self.portwatch.get("pct_of_baseline", 0)
            if pw_pct >= 80:   pw_signal = "OPEN"
            elif pw_pct >= 45: pw_signal = "REDUCED"
            else:              pw_signal = "DISRUPTED"

        # Polymarket signal — secondary
        poly_signal = None
        poly_pct = None
        poly_markets = [m for m in self.polymarkets.values() if m.get("yes_probability") is not None]
        if poly_markets:
            poly_pct = max(m["yes_probability"] for m in poly_markets)
            if poly_pct >= 70:   poly_signal = "OPEN"
            elif poly_pct >= 40: poly_signal = "REDUCED"
            else:                poly_signal = "DISRUPTED"

        # Risk score signal — tertiary (only strong signal if CRITICAL)
        risk_signal = None
        if risk["level"] == "CRITICAL": risk_signal = "DISRUPTED"
        elif risk["level"] == "HIGH":   risk_signal = "REDUCED"
        # LOW/ELEVATED don't contribute to avoid false positives

        # Priority: PortWatch > Polymarket > Risk
        if pw_signal is not None:
            # We have authoritative data — use it directly
            if pw_signal == "OPEN":
                is_open = "YES"
                confidence = "HIGH"
            elif pw_signal == "DISRUPTED":
                is_open = "NO"
                confidence = "HIGH"
            else:  # REDUCED
                is_open = "UNCERTAIN"
                confidence = "MEDIUM"
        elif poly_signal is not None:
            if poly_signal == "OPEN":
                is_open = "YES"
                confidence = "MEDIUM"
            elif poly_signal == "DISRUPTED":
                is_open = "NO"
                confidence = "MEDIUM"
            else:
                is_open = "UNCERTAIN"
                confidence = "LOW"
        elif risk_signal == "DISRUPTED":
            # Only elevate to NO if CRITICAL risk and no other data
            is_open = "UNCERTAIN"
            confidence = "LOW"
        else:
            is_open = "UNCERTAIN"
            confidence = "LOW"

        with self._lock:
            vessel_count = sum(
                1 for v in self.vessels.values()
                if time.time() - v.get("_ts", 0) < self.VESSEL_TTL
            )
            today = time.strftime("%Y-%m-%d", time.gmtime())
            today_transits = len(self.daily_transits.get(today, set()))
            brent = self.market.get("BZ=F") or self.market.get("BRENT") or {}
            wti   = self.market.get("CL=F") or {}

        return {
            "is_open": is_open,
            "confidence": confidence,
            "risk_score": risk["score"],
            "risk_level": risk["level"],
            "portwatch_pct": pw_pct,
            "portwatch_latest_date": self.portwatch.get("latest_date") if self.portwatch else None,
            "polymarket_yes_pct": poly_pct,
            "active_vessels": vessel_count,
            "today_transits": today_transits,
            "brent_price": brent.get("price"),
            "brent_change_pct": brent.get("change_pct"),
            "wti_price": wti.get("price"),
            "wti_change_pct": wti.get("change_pct"),
            "signals": {
                "portwatch": pw_signal,
                "polymarket": poly_signal,
                "risk": risk_signal,
            },
        }

    def update_market(self, tick: dict):
        with self._lock:
            if tick.get("market_type") == "prediction":
                self.polymarkets[tick["symbol"]] = tick
            else:
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

    def set_portwatch(self, data: dict):
        with self._lock:
            self.portwatch = data

    def touch_source(self, name: str):
        """Record that a data source is alive."""
        with self._lock:
            self._source_last_seen[name] = time.time()

    def get_health(self) -> dict:
        """Return health status for each data source."""
        now = time.time()
        with self._lock:
            seen = dict(self._source_last_seen)
            vessel_count = sum(1 for v in self.vessels.values()
                               if now - v.get("_ts", 0) < self.VESSEL_TTL)

        def age(ts):
            if ts is None:
                return None
            return round(now - ts)

        def status(ts, warn_after, dead_after):
            if ts is None:
                return "unknown"
            a = now - ts
            if a > dead_after:
                return "dead"
            if a > warn_after:
                return "stale"
            return "ok"

        return {
            "aisstream":    {"status": status(seen.get("aisstream"),    120, 600),  "age_s": age(seen.get("aisstream"))},
            "marinetraffic":{"status": status(seen.get("marinetraffic"),700, 1800), "age_s": age(seen.get("marinetraffic"))},
            "portwatch":    {"status": status(seen.get("portwatch"),    25200, 86400), "age_s": age(seen.get("portwatch"))},
            "news":         {"status": status(seen.get("news"),         3600, 7200),  "age_s": age(seen.get("news"))},
            "markets":      {"status": status(seen.get("markets"),      600, 3600),   "age_s": age(seen.get("markets"))},
            "prediction_mkts":{"status": status(seen.get("prediction_mkts"), 600, 3600), "age_s": age(seen.get("prediction_mkts"))},
            "synthesizer":  {"status": status(seen.get("synthesizer"),  3600, 7200), "age_s": age(seen.get("synthesizer"))},
            "vessels_live": vessel_count,
        }

    def record_risk_snapshot(self):
        """Called every 5 min by background thread to build the risk history sparkline."""
        risk = self.get_risk()
        with self._lock:
            self.risk_history.append({
                "ts": round(time.time()),
                "score": risk["score"],
                "level": risk["level"],
            })

    def get_risk_history(self) -> list:
        with self._lock:
            return list(self.risk_history)

    def update_heatmap(self, cell: dict):
        key = cell.get("cellId") or f"{cell.get('lat', 0):.2f}_{cell.get('lon', 0):.2f}"
        with self._lock:
            self.heatmap[key] = cell

    def update_prediction(self, pred: dict):
        mmsi = pred.get("mmsi")
        if mmsi is None:
            return
        with self._lock:
            self.predictions[str(mmsi)] = pred

    def update_fleet_edge(self, edge: dict):
        src = edge.get("sourceMmsi")
        tgt = edge.get("targetMmsi")
        if src is None or tgt is None:
            return
        key = f"{src}:{tgt}"
        with self._lock:
            existing = self.fleet_graph.get(key, {})
            edge["proximityCount"] = max(edge.get("proximityCount", 1),
                                         existing.get("proximityCount", 0))
            self.fleet_graph[key] = edge

    def update_throughput(self, snap: dict):
        key = snap.get("date") or snap.get("timestamp", "unknown")
        with self._lock:
            self.throughput[key] = snap

    def get_heatmap(self) -> list:
        with self._lock:
            return list(self.heatmap.values())

    def get_predictions(self) -> list:
        with self._lock:
            return list(self.predictions.values())

    def get_fleet_graph(self) -> dict:
        """Return {nodes: [...], edges: [...]} for D3 force-directed."""
        with self._lock:
            edges = list(self.fleet_graph.values())
        mmsis = set()
        for e in edges:
            mmsis.add(e["sourceMmsi"])
            mmsis.add(e["targetMmsi"])
        nodes = [{"id": m} for m in mmsis]
        return {"nodes": nodes, "edges": edges}

    def get_throughput(self) -> list:
        with self._lock:
            return sorted(self.throughput.values(), key=lambda x: x.get("date", ""))

    def set_geofence(self, gf: dict):
        with self._lock:
            if gf.get("active", True):
                self.geofences[gf["id"]] = gf
            else:
                self.geofences.pop(gf["id"], None)

    def get_geofences(self) -> list:
        with self._lock:
            return list(self.geofences.values())

    def stats(self) -> dict:
        now = time.time()
        with self._lock:
            active = sum(1 for v in self.vessels.values() if now - v.get("_ts", 0) < self.VESSEL_TTL)
            tankers = sum(
                1 for v in self.vessels.values()
                if now - v.get("_ts", 0) < self.VESSEL_TTL
                and 80 <= v.get("ship_type", 0) <= 89
            )
            military = sum(
                1 for v in self.vessels.values()
                if now - v.get("_ts", 0) < self.VESSEL_TTL
                and v.get("ship_type", 0) in (35, 36)
            )
            critical = sum(1 for e in self.events if e.get("severity") == "CRITICAL")
            high = sum(1 for e in self.events if e.get("severity") == "HIGH")
            today = time.strftime("%Y-%m-%d", time.gmtime())
            today_transits = len(self.daily_transits.get(today, set()))
        return {
            "vessels": active,
            "tankers": tankers,
            "military": military,
            "critical": critical,
            "high": high,
            "today_transits": today_transits,
        }


state = AppState()
