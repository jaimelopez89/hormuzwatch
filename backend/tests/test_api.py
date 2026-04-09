import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

# Patch Kafka before importing api
with patch("kafka_utils.make_consumer"), patch("kafka_utils.make_producer"):
    from api import app

client = TestClient(app)

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

def test_vessels_returns_list():
    resp = client.get("/api/vessels")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

def test_briefing_returns_none_when_empty():
    resp = client.get("/api/briefing")
    assert resp.status_code == 200
    data = resp.json()
    assert data is None or isinstance(data, dict)

def test_market_returns_dict():
    resp = client.get("/api/market")
    assert resp.status_code == 200
    assert isinstance(resp.json(), dict)

def test_risk_returns_score():
    resp = client.get("/api/risk")
    assert resp.status_code == 200
    data = resp.json()
    assert "score" in data
    assert 0 <= data["score"] <= 100
