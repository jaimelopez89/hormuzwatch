import time
import pytest
from trigger import TriggerController

def make_ctrl():
    return TriggerController()

def test_blocks_within_min_interval():
    ctrl = make_ctrl()
    ctrl.last_call_time = time.time()  # just called
    assert ctrl.should_trigger({"severity": "HIGH"}, 50, 50) is False

def test_allows_critical_after_interval():
    ctrl = make_ctrl()
    ctrl.last_call_time = time.time() - 130  # 130s ago
    assert ctrl.should_trigger({"severity": "CRITICAL"}, 50, 50) is True

def test_allows_score_delta_above_threshold():
    ctrl = make_ctrl()
    ctrl.last_call_time = time.time() - 130
    assert ctrl.should_trigger({"severity": "MEDIUM"}, 80, 70) is True  # delta=10 >= 8

def test_blocks_score_delta_below_threshold():
    ctrl = make_ctrl()
    ctrl.last_call_time = time.time() - 130
    assert ctrl.should_trigger({"severity": "MEDIUM"}, 75, 72) is False  # delta=3 < 8

def test_haiku_model_for_low_risk():
    ctrl = make_ctrl()
    assert "haiku" in ctrl.get_model(30).lower()

def test_sonnet_model_for_high_risk():
    ctrl = make_ctrl()
    assert "sonnet" in ctrl.get_model(45).lower()
    assert "sonnet" in ctrl.get_model(80).lower()
