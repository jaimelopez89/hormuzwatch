import pytest
from news_poller import parse_entry, matches_keywords
from sentiment import score_sentiment

def test_parse_entry_extracts_fields():
    class FakeEntry:
        title = "Iran threatens tanker traffic in Hormuz"
        summary = "IRGC warns of disruption to oil shipping."
        link = "https://reuters.com/article/123"
        published = "Thu, 09 Apr 2026 10:00:00 GMT"

    result = parse_entry(FakeEntry(), source="reuters")
    assert result["headline"] == "Iran threatens tanker traffic in Hormuz"
    assert result["source"] == "reuters"
    assert result["url"] == "https://reuters.com/article/123"
    assert "published_at" in result

def test_matches_keywords_true():
    assert matches_keywords("Iran seizes tanker in Hormuz strait") is True
    assert matches_keywords("IRGC patrol boat intercepts oil vessel") is True

def test_matches_keywords_false():
    assert matches_keywords("UK election results announced") is False
    assert matches_keywords("Weather forecast for London") is False

def test_sentiment_negative_for_escalation():
    assert score_sentiment("Iran seizes tanker, threatens to close strait") < 0

def test_sentiment_positive_for_deescalation():
    assert score_sentiment("Iran and US reach diplomatic agreement, tensions ease") > 0

def test_sentiment_neutral():
    assert score_sentiment("Vessel transits Hormuz without incident") == 0
