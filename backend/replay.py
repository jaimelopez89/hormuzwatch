# backend/replay.py
"""AIS position recorder + replay service."""
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

REPLAY_DIR = Path(os.environ.get("REPLAY_DIR", "/tmp/hormuzwatch-replay"))
REPLAY_DIR.mkdir(parents=True, exist_ok=True)

_replay_active = False


def record_position(pos: dict):
    """Append a vessel position to today's JSONL file."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = REPLAY_DIR / f"{today}.jsonl"
    try:
        with open(path, "a") as f:
            f.write(json.dumps(pos) + "\n")
    except Exception as e:
        log.debug("replay record error: %s", e)


def list_available_dates() -> list:
    return sorted(p.stem for p in REPLAY_DIR.glob("*.jsonl"))


async def run_replay(date: str, speed_x: float, state):
    global _replay_active
    path = REPLAY_DIR / f"{date}.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"No replay data for {date}")

    _replay_active = True
    log.info("Replay started: %s at %.1fx speed", date, speed_x)

    prev_ts = None
    with open(path) as f:
        for line in f:
            if not _replay_active:
                break
            try:
                pos = json.loads(line.strip())
            except Exception:
                continue

            ts_str = pos.get("timestamp") or pos.get("_ts_iso")
            if ts_str and prev_ts is not None:
                try:
                    curr_ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).timestamp()
                    gap = (curr_ts - prev_ts) / speed_x
                    if 0 < gap < 30:
                        await asyncio.sleep(gap)
                    prev_ts = curr_ts
                except Exception:
                    pass
            elif ts_str and prev_ts is None:
                try:
                    prev_ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).timestamp()
                except Exception:
                    pass

            pos["_replay"] = True
            state.update_vessel(pos)

    _replay_active = False
    log.info("Replay finished: %s", date)


def stop_replay():
    global _replay_active
    _replay_active = False
