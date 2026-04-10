"""RSS news poller — filters for Hormuz/Iran keywords, produces to Kafka."""
import hashlib
import logging
import os
import time
from collections import OrderedDict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import feedparser
from dotenv import load_dotenv
from sentiment import score_sentiment

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

FEEDS = [
    # Tier 1 — Maritime / defence primary sources
    ("usni",       "https://news.usni.org/feed"),
    ("maritimeexecutive", "https://maritime-executive.com/rss/articles"),
    ("tradewinds", "https://www.tradewindsnews.com/rss"),
    ("lloydslist", "https://lloydslist.maritimeintelligence.informa.com/rss"),

    # Tier 2 — General news with strong ME/energy coverage
    ("reuters",    "https://feeds.reuters.com/reuters/worldNews"),
    ("aljazeera",  "https://www.aljazeera.com/xml/rss/all.xml"),
    ("ap",         "https://rsshub.app/apnews/topics/world-news"),
    ("bbc",        "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml"),
    ("ft",         "https://www.ft.com/world/middle-east?format=rss"),

    # Tier 3 — Energy / sanctions specific
    ("oilprice",   "https://oilprice.com/rss/main"),
    ("platts",     "https://www.spglobal.com/commodityinsights/en/rss-feed/oil"),
    ("trafigura",  "https://www.trafigura.com/news-and-insights/rss"),
    ("ofac",       "https://home.treasury.gov/news/press-releases/rss"),

    # Tier 4 — Regional
    ("iranintl",   "https://www.iranintl.com/en/rss"),
    ("middleeasteye", "https://www.middleeasteye.net/rss"),
    ("gulfnews",   "https://gulfnews.com/rss"),
]

KEYWORDS = [
    # Geography
    "hormuz", "strait of hormuz", "persian gulf", "gulf of oman",
    "oman", "uae", "bahrain", "bandar abbas", "kish island", "qeshm",
    # Actors
    "iran", "irgc", "irgcn", "nioc", "irisl",
    # Events
    "tanker", "oil tanker", "lng carrier", "vessel seizure", "ship seized",
    "naval", "warship", "maritime", "sanctions", "oil sanctions",
    "drone attack", "missile", "mine", "limpet",
    # Commodities
    "crude oil", "brent", "wti", "oil price",
]

TOPIC = "news-events"
POLL_INTERVAL = 60  # seconds
_seen: OrderedDict = OrderedDict()
_SEEN_MAX = 5000


def matches_keywords(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in KEYWORDS)


def parse_entry(entry, source: str) -> dict:
    text = f"{entry.title} {getattr(entry, 'summary', '')}"
    try:
        published = parsedate_to_datetime(entry.published).isoformat()
    except Exception:
        published = datetime.now(timezone.utc).isoformat()
    return {
        "id": hashlib.md5(entry.link.encode()).hexdigest(),
        "source": source,
        "headline": entry.title,
        "summary": getattr(entry, "summary", ""),
        "url": entry.link,
        "published_at": published,
        "sentiment": score_sentiment(text),
        "keywords_matched": [kw for kw in KEYWORDS if kw in text.lower()],
    }


def poll_once(producer):
    for source, url in FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                text = f"{entry.title} {getattr(entry, 'summary', '')}"
                if not matches_keywords(text):
                    continue
                event = parse_entry(entry, source)
                if event["id"] in _seen:
                    continue
                _seen[event["id"]] = True
                if len(_seen) > _SEEN_MAX:
                    _seen.popitem(last=False)  # evict oldest
                producer.send(TOPIC, event)
                log.info(f"[{source}] {entry.title[:80]}")
        except Exception as e:
            log.warning(f"Feed error {source}: {e}")


def run():
    from kafka_utils import make_producer  # lazy import — not needed for unit tests
    producer = make_producer()
    log.info("News poller started.")
    while True:
        poll_once(producer)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
