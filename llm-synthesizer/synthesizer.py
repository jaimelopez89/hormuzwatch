"""LLM Synthesizer — consumes intelligence-events, produces briefings via Claude."""
import json
import logging
import os
import time
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

INPUT_TOPIC = "intelligence-events"
OUTPUT_TOPIC = "briefings"
MARKET_TOPIC = "market-ticks"
NEWS_TOPIC = "news-events"


class Synthesizer:
    def __init__(self):
        from kafka_utils import make_producer, make_consumer
        from trigger import TriggerController
        from precedents import load_precedents, format_for_prompt

        import anthropic
        self.client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        self.producer = make_producer()
        self.trigger = TriggerController()
        self.risk_score = 5
        self.recent_events: list[dict] = []
        self.recent_news: list[dict] = []
        self.market_snapshot: dict[str, dict] = {}
        self.precedents_text = format_for_prompt(load_precedents())

    def ingest_event(self, event: dict):
        self.recent_events.append(event)
        if len(self.recent_events) > 50:
            self.recent_events.pop(0)
        self.risk_score = min(100, self.risk_score + event.get("scoreContribution", 0))
        self.risk_score = max(5, int(self.risk_score * 0.98))

    def ingest_news(self, news: dict):
        self.recent_news.append(news)
        if len(self.recent_news) > 20:
            self.recent_news.pop(0)

    def ingest_market(self, tick: dict):
        self.market_snapshot[tick["symbol"]] = tick

    def call_claude(self) -> dict | None:
        from prompt_builder import build_prompt
        model = self.trigger.get_model(self.risk_score)
        prompt = build_prompt(
            self.risk_score,
            self.recent_events,
            self.recent_news,
            list(self.market_snapshot.values()),
            self.precedents_text,
        )
        try:
            resp = self.client.messages.create(
                model=model,
                max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text
            briefing = json.loads(raw)
            briefing["generated_at"] = datetime.now(timezone.utc).isoformat()
            briefing["model_used"] = model
            return briefing
        except Exception as e:
            log.error(f"Claude call failed: {e}")
            return None

    def run(self):
        from kafka_utils import make_consumer
        consumer = make_consumer([INPUT_TOPIC, MARKET_TOPIC, NEWS_TOPIC], "llm-synthesizer")
        log.info("LLM Synthesizer started.")
        last_score = self.risk_score
        for msg in consumer:
            topic = msg.topic
            value = msg.value
            if topic == INPUT_TOPIC:
                self.ingest_event(value)
                if self.trigger.should_trigger(value, self.risk_score, last_score):
                    briefing = self.call_claude()
                    if briefing:
                        self.producer.send(OUTPUT_TOPIC, briefing)
                        log.info(f"Briefing published. Risk: {self.risk_score}. Model: {briefing['model_used']}")
                        self.trigger.record_call(self.risk_score)
                        last_score = self.risk_score
            elif topic == NEWS_TOPIC:
                self.ingest_news(value)
            elif topic == MARKET_TOPIC:
                self.ingest_market(value)


if __name__ == "__main__":
    Synthesizer().run()
