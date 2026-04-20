"""Kafka producer/consumer using confluent-kafka (librdkafka).

confluent-kafka handles SSL/mTLS more reliably than kafka-python-ng,
particularly from cloud environments like Railway.

Supports two cert modes:
  1. File paths: KAFKA_CA_CERT_PATH, KAFKA_SSL_CERT_PATH, KAFKA_SSL_KEY_PATH (local dev)
  2. PEM strings: KAFKA_CA_CERT, KAFKA_SSL_CERT, KAFKA_SSL_KEY (cloud deploy)
"""
import json
import logging
import os
import tempfile

from confluent_kafka import Producer, Consumer, KafkaError

logging.getLogger("confluent_kafka").setLevel(logging.WARNING)
log = logging.getLogger(__name__)

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Cache temp file paths (one per process)
_cert_cache: dict[str, str] = {}


def _resolve(path: str) -> str:
    if os.path.isabs(path):
        return path
    return os.path.join(_PROJECT_ROOT, path)


def _get_cert_path(path_env: str, pem_env: str) -> str | None:
    """Return a filesystem path for a cert, from file path or PEM string."""
    # Mode 1: file path (local dev)
    file_path = os.environ.get(path_env)
    if file_path:
        resolved = _resolve(file_path)
        if os.path.exists(resolved):
            return resolved

    # Mode 2: PEM string (cloud deploy)
    pem = os.environ.get(pem_env)
    if not pem:
        return None

    cache_key = pem_env
    if cache_key in _cert_cache and os.path.exists(_cert_cache[cache_key]):
        return _cert_cache[cache_key]

    pem = pem.replace("\\n", "\n")
    fd, path = tempfile.mkstemp(suffix=".pem", prefix=f"kafka-{pem_env.lower()}-")
    with os.fdopen(fd, "w") as f:
        f.write(pem)
    _cert_cache[cache_key] = path
    return path


def _ssl_config() -> dict:
    """Build confluent-kafka SSL config dict."""
    ca = _get_cert_path("KAFKA_CA_CERT_PATH", "KAFKA_CA_CERT")
    cert = _get_cert_path("KAFKA_SSL_CERT_PATH", "KAFKA_SSL_CERT")
    key = _get_cert_path("KAFKA_SSL_KEY_PATH", "KAFKA_SSL_KEY")

    if not ca:
        raise RuntimeError(
            "Kafka SSL not configured. Set KAFKA_CA_CERT (PEM string) or KAFKA_CA_CERT_PATH."
        )

    cfg = {
        "security.protocol": "SSL",
        "ssl.ca.location": ca,
    }
    if cert:
        cfg["ssl.certificate.location"] = cert
    if key:
        cfg["ssl.key.location"] = key
    return cfg


def make_producer():
    cfg = {
        "bootstrap.servers": os.environ["KAFKA_BOOTSTRAP_SERVERS"],
        "client.id": "hormuzwatch-backend",
        "compression.type": "gzip",
        "linger.ms": 100,
        "batch.size": 16384,
        "connections.max.idle.ms": 540000,
        **_ssl_config(),
    }

    producer = Producer(cfg)
    log.info("confluent-kafka Producer created (bootstrap: %s)", cfg["bootstrap.servers"])
    return _ProducerWrapper(producer)


def make_consumer(topics, group_id):
    cfg = {
        "bootstrap.servers": os.environ["KAFKA_BOOTSTRAP_SERVERS"],
        "group.id": group_id,
        "auto.offset.reset": "latest",
        "connections.max.idle.ms": 540000,
        "session.timeout.ms": 30000,
        "heartbeat.interval.ms": 10000,
        **_ssl_config(),
    }

    consumer = Consumer(cfg)
    consumer.subscribe(topics)
    log.info("confluent-kafka Consumer created (group: %s, topics: %s)", group_id, topics)
    return _ConsumerWrapper(consumer)


class _ProducerWrapper:
    """Wrapper that mimics the kafka-python Producer.send() API."""

    def __init__(self, producer: Producer):
        self._producer = producer
        self._poll_count = 0

    def send(self, topic: str, value):
        data = json.dumps(value).encode("utf-8") if not isinstance(value, bytes) else value
        self._producer.produce(topic, value=data, callback=self._on_delivery)
        self._poll_count += 1
        if self._poll_count % 50 == 0:
            self._producer.poll(0)

    def flush(self, timeout=10):
        self._producer.flush(timeout)

    def close(self):
        self._producer.flush(5)

    @staticmethod
    def _on_delivery(err, msg):
        if err:
            log.error("Kafka delivery failed: %s", err)


class _ConsumerWrapper:
    """Wrapper that yields messages like kafka-python's `for msg in consumer`."""

    def __init__(self, consumer: Consumer):
        self._consumer = consumer

    def __iter__(self):
        return self

    def __next__(self):
        while True:
            msg = self._consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                log.error("Kafka consumer error: %s", msg.error())
                continue
            return _MessageWrapper(msg)

    def close(self):
        self._consumer.close()


class _MessageWrapper:
    """Mimics kafka-python's message object."""

    def __init__(self, msg):
        self.topic = msg.topic()
        self._raw = msg.value()

    @property
    def value(self):
        return json.loads(self._raw.decode("utf-8"))
