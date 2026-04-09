import pytest
from ingestion.ais_connector import parse_position, is_in_hormuz_bbox

def test_parse_position_returns_expected_fields():
    raw = {
        "MessageType": "PositionReport",
        "MetaData": {"MMSI": 123456789, "ShipName": "TEST VESSEL", "time_utc": "2026-04-09 12:00:00"},
        "Message": {
            "PositionReport": {
                "Latitude": 26.5, "Longitude": 56.3,
                "Sog": 12.5, "Cog": 270.0,
                "TrueHeading": 268, "NavigationalStatus": 0
            }
        }
    }
    pos = parse_position(raw)
    assert pos["mmsi"] == 123456789
    assert pos["name"] == "TEST VESSEL"
    assert pos["lat"] == 26.5
    assert pos["lon"] == 56.3
    assert pos["speed"] == 12.5
    assert pos["heading"] == 268
    assert pos["nav_status"] == 0
    assert "timestamp" in pos

def test_in_hormuz_bbox():
    assert is_in_hormuz_bbox(26.5, 56.3) is True   # center of strait
    assert is_in_hormuz_bbox(51.5, 0.0) is False    # London
    assert is_in_hormuz_bbox(22.0, 54.0) is True    # bbox edge

def test_outside_hormuz_bbox():
    assert is_in_hormuz_bbox(30.0, 56.0) is False   # too far north
    assert is_in_hormuz_bbox(26.0, 50.0) is False   # too far west


def test_parse_position_returns_none_outside_bbox():
    raw = {
        "MetaData": {"MMSI": 999999999, "ShipName": "FAR AWAY", "time_utc": "2026-04-09 10:00:00"},
        "Message": {
            "PositionReport": {
                "Latitude": 51.5, "Longitude": 0.0,  # London
                "Sog": 10.0, "Cog": 0.0, "TrueHeading": 0, "NavigationalStatus": 0
            }
        }
    }
    assert parse_position(raw) is None


def test_parse_position_returns_none_for_malformed_input():
    assert parse_position({}) is None
    assert parse_position({"MetaData": {}}) is None
    assert parse_position({"MetaData": {"MMSI": 1}, "Message": {}}) is None
