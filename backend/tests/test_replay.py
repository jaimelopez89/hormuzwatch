# backend/tests/test_replay.py
import json
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture(autouse=True)
def tmp_replay_dir(tmp_path, monkeypatch):
    """Redirect REPLAY_DIR to a temp directory for every test."""
    monkeypatch.setenv("REPLAY_DIR", str(tmp_path))
    # Re-import replay so it picks up the new env var
    import importlib
    import replay
    importlib.reload(replay)
    return tmp_path


def test_record_position_creates_jsonl_file(tmp_path):
    from datetime import datetime, timezone
    import replay

    pos = {
        "mmsi": 123456789,
        "lat": 26.5,
        "lon": 56.3,
        "speed": 10.0,
        "timestamp": "2026-04-14T12:00:00Z",
    }
    replay.record_position(pos)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = tmp_path / f"{today}.jsonl"
    assert path.exists(), "JSONL file should be created"
    with open(path) as f:
        data = json.loads(f.readline())
    assert data["mmsi"] == 123456789


def test_record_position_appends_multiple(tmp_path):
    import replay

    pos1 = {"mmsi": 111, "lat": 26.0, "lon": 56.0, "timestamp": "2026-04-14T12:00:00Z"}
    pos2 = {"mmsi": 222, "lat": 26.1, "lon": 56.1, "timestamp": "2026-04-14T12:01:00Z"}
    replay.record_position(pos1)
    replay.record_position(pos2)

    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = (tmp_path / f"{today}.jsonl").read_text().strip().split("\n")
    assert len(lines) == 2


def test_list_available_dates_empty(tmp_path):
    import replay

    assert replay.list_available_dates() == []


def test_list_available_dates_returns_sorted(tmp_path):
    import replay

    (tmp_path / "2026-04-13.jsonl").write_text("{}\n")
    (tmp_path / "2026-04-15.jsonl").write_text("{}\n")
    (tmp_path / "2026-04-14.jsonl").write_text("{}\n")
    dates = replay.list_available_dates()
    assert dates == ["2026-04-13", "2026-04-14", "2026-04-15"]


def test_stop_replay_sets_flag_false():
    import replay

    replay._replay_active = True
    replay.stop_replay()
    assert replay._replay_active is False
