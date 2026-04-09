"""Cost-control trigger logic for LLM Synthesizer."""
import time
from datetime import datetime, timezone


class TriggerController:
    MIN_INTERVAL = 120          # 2 minutes
    QUIET_MIN_INTERVAL = 600    # 10 minutes during quiet hours
    SCORE_DELTA_THRESHOLD = 8
    QUIET_HOURS = (2, 6)        # UTC

    def __init__(self):
        self.last_call_time = 0.0
        self.last_score = 5

    def should_trigger(self, event: dict, current_score: int, last_score: int) -> bool:
        elapsed = time.time() - self.last_call_time
        min_interval = self._min_interval()
        if elapsed < min_interval:
            return False
        if event and event.get("severity") == "CRITICAL":
            return True
        if abs(current_score - last_score) >= self.SCORE_DELTA_THRESHOLD:
            return True
        return False

    def get_model(self, risk_score: int) -> str:
        if risk_score >= 40:
            return "claude-sonnet-4-6"
        return "claude-haiku-4-5-20251001"

    def record_call(self, score: int):
        self.last_call_time = time.time()
        self.last_score = score

    def _min_interval(self) -> float:
        hour = datetime.now(timezone.utc).hour
        if self.QUIET_HOURS[0] <= hour < self.QUIET_HOURS[1]:
            return self.QUIET_MIN_INTERVAL
        return self.MIN_INTERVAL
