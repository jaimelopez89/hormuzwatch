import pytest
from market_poller import format_tick, SYMBOLS

def test_symbols_contains_expected():
    symbols = [s["symbol"] for s in SYMBOLS]
    assert "CL=F" in symbols   # WTI Crude
    assert "BZ=F" in symbols   # Brent
    assert "FRO" in symbols    # Frontline

def test_format_tick():
    tick = format_tick("CL=F", "WTI Crude", 94.20, 91.00)
    assert tick["symbol"] == "CL=F"
    assert tick["name"] == "WTI Crude"
    assert tick["price"] == 94.20
    assert abs(tick["change_pct"] - 3.52) < 0.01
    assert "timestamp" in tick

def test_format_tick_zero_prev_price():
    tick = format_tick("CL=F", "WTI Crude", 94.20, 0)
    assert tick["change_pct"] == 0.0
