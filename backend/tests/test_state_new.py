# backend/tests/test_state_new.py
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from state import AppState


@pytest.fixture
def s():
    """Fresh AppState for each test."""
    return AppState()


def test_update_heatmap_stores_by_cell_id(s):
    cell = {
        "cellId": "26.2:56.0",
        "lat": 26.2,
        "lon": 56.0,
        "riskScore": 35,
        "eventCount": 3,
        "severity": "MEDIUM",
        "timestamp": 0,
    }
    s.update_heatmap(cell)
    result = s.get_heatmap()
    assert len(result) == 1
    assert result[0]["cellId"] == "26.2:56.0"


def test_update_heatmap_overwrites_same_cell(s):
    cell1 = {
        "cellId": "26.2:56.0",
        "riskScore": 10,
        "lat": 26.2,
        "lon": 56.0,
        "eventCount": 1,
        "severity": "LOW",
        "timestamp": 0,
    }
    cell2 = {
        "cellId": "26.2:56.0",
        "riskScore": 55,
        "lat": 26.2,
        "lon": 56.0,
        "eventCount": 5,
        "severity": "HIGH",
        "timestamp": 1,
    }
    s.update_heatmap(cell1)
    s.update_heatmap(cell2)
    result = s.get_heatmap()
    assert len(result) == 1
    assert result[0]["riskScore"] == 55


def test_update_prediction_stores_by_mmsi(s):
    pred = {
        "mmsi": 123456789,
        "name": "TANKER A",
        "predictedPath": [[26.5, 56.3, 15]],
        "speedKnots": 10.0,
        "courseDegs": 270.0,
        "timestamp": 0,
    }
    s.update_prediction(pred)
    result = s.get_predictions()
    assert len(result) == 1
    # The dict itself still contains the original int mmsi
    assert result[0]["mmsi"] == 123456789


def test_update_fleet_edge_keeps_max_proximity_count(s):
    edge1 = {
        "sourceMmsi": 111,
        "targetMmsi": 222,
        "proximityCount": 3,
        "lastLat": 26.5,
        "lastLon": 56.3,
        "lastSeen": 0,
    }
    edge2 = {
        "sourceMmsi": 111,
        "targetMmsi": 222,
        "proximityCount": 7,
        "lastLat": 26.5,
        "lastLon": 56.3,
        "lastSeen": 1,
    }
    s.update_fleet_edge(edge1)
    s.update_fleet_edge(edge2)
    result = s.get_fleet_graph()
    assert result["edges"][0]["proximityCount"] == 7


def test_get_fleet_graph_returns_nodes_and_edges(s):
    edge = {
        "sourceMmsi": 100,
        "targetMmsi": 200,
        "proximityCount": 2,
        "lastLat": 26.0,
        "lastLon": 56.0,
        "lastSeen": 0,
    }
    s.update_fleet_edge(edge)
    graph = s.get_fleet_graph()
    assert "nodes" in graph
    assert "edges" in graph
    node_ids = {n["id"] for n in graph["nodes"]}
    assert 100 in node_ids
    assert 200 in node_ids


def test_update_throughput_stores_by_date(s):
    snap = {
        "date": "2026-04-14",
        "tankerCount": 14,
        "vesselCount": 187,
        "barrelsPerDay": 14000000,
        "westboundTransits": 14,
        "timestamp": 0,
    }
    s.update_throughput(snap)
    result = s.get_throughput()
    assert len(result) == 1
    assert result[0]["date"] == "2026-04-14"
    assert result[0]["barrelsPerDay"] == 14000000


def test_get_throughput_sorted_by_date(s):
    s.update_throughput({
        "date": "2026-04-15",
        "tankerCount": 10,
        "vesselCount": 100,
        "barrelsPerDay": 10000000,
        "westboundTransits": 10,
        "timestamp": 0,
    })
    s.update_throughput({
        "date": "2026-04-13",
        "tankerCount": 8,
        "vesselCount": 90,
        "barrelsPerDay": 8000000,
        "westboundTransits": 8,
        "timestamp": 0,
    })
    result = s.get_throughput()
    assert result[0]["date"] == "2026-04-13"
    assert result[1]["date"] == "2026-04-15"


def test_set_geofence_stores_active_zone(s):
    gf = {"id": "zone-1", "name": "Hormuz Entrance", "active": True, "geometry": {}}
    s.set_geofence(gf)
    result = s.get_geofences()
    assert len(result) == 1
    assert result[0]["id"] == "zone-1"


def test_set_geofence_removes_inactive_zone(s):
    s.set_geofence({"id": "zone-1", "name": "Test", "active": True, "geometry": {}})
    s.set_geofence({"id": "zone-1", "active": False})
    result = s.get_geofences()
    assert len(result) == 0


def test_fleet_edge_key_is_stable(s):
    # Both directions should coexist as separate edges (not merged)
    edge_ab = {
        "sourceMmsi": 100,
        "targetMmsi": 200,
        "proximityCount": 1,
        "lastLat": 26.0,
        "lastLon": 56.0,
        "lastSeen": 0,
    }
    edge_ba = {
        "sourceMmsi": 200,
        "targetMmsi": 100,
        "proximityCount": 1,
        "lastLat": 26.0,
        "lastLon": 56.0,
        "lastSeen": 0,
    }
    s.update_fleet_edge(edge_ab)
    s.update_fleet_edge(edge_ba)
    graph = s.get_fleet_graph()
    assert len(graph["edges"]) == 2
