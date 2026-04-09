import pytest
from prompt_builder import build_prompt

def test_prompt_contains_risk_score():
    prompt = build_prompt(
        risk_score=72,
        events=[{"type": "DARK_AIS", "severity": "HIGH", "description": "Vessel went dark"}],
        news=[{"headline": "Iran warns shipping", "sentiment": -2}],
        market=[{"symbol": "CL=F", "name": "WTI Crude", "price": 94.20, "change_pct": 3.4}],
        precedents="- 2019 attacks: Brent +$10",
    )
    assert "72" in prompt
    assert "DARK_AIS" in prompt
    assert "Iran warns shipping" in prompt
    assert "WTI Crude" in prompt
    assert "2019 attacks" in prompt

def test_prompt_requests_json_output():
    prompt = build_prompt(72, [], [], [], "")
    assert "JSON" in prompt or "json" in prompt

def test_prompt_is_string():
    prompt = build_prompt(50, [], [], [], "")
    assert isinstance(prompt, str)
    assert len(prompt) > 100
