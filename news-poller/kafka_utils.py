import json
import logging
import os
import ssl
from kafka import KafkaProducer, KafkaConsumer

# Suppress noisy connection debug logs — node flapping is non-critical
logging.getLogger("kafka.conn").setLevel(logging.WARNING)
logging.getLogger("kafka.client").setLevel(logging.WARNING)
logging.getLogger("kafka.cluster").setLevel(logging.WARNING)

# kafka_utils.py lives one level inside the project root (ingestion/, backend/, etc.)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _resolve(path: str) -> str:
    """Resolve a relative path against the project root, not the CWD."""
    if os.path.isabs(path):
        return path
    return os.path.join(_PROJECT_ROOT, path)


def _ssl_context():
    ca_path = _resolve(os.environ["KAFKA_CA_CERT_PATH"])
    if not os.path.exists(ca_path):
        raise RuntimeError(f"Kafka CA cert not found at {ca_path!r}. Check KAFKA_CA_CERT_PATH in your .env")
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(ca_path)
    # Aiven requires mutual TLS — resolve paths only when env vars are set
    cert_env = os.environ.get("KAFKA_SSL_CERT_PATH", "")
    key_env = os.environ.get("KAFKA_SSL_KEY_PATH", "")
    if cert_env and key_env:
        ctx.load_cert_chain(certfile=_resolve(cert_env), keyfile=_resolve(key_env))
    return ctx


# Aiven brokers close idle connections after ~10 min; stay under that threshold.
_IDLE_MS = 9 * 60 * 1000


def make_producer():
    return KafkaProducer(
        bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"].split(","),
        security_protocol="SSL",
        ssl_context=_ssl_context(),
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        compression_type="gzip",
        linger_ms=100,
        batch_size=16384,
        connections_max_idle_ms=_IDLE_MS,
    )


def make_consumer(topics, group_id, max_poll_interval_ms=300_000):
    return KafkaConsumer(
        *topics,
        bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"].split(","),
        security_protocol="SSL",
        ssl_context=_ssl_context(),
        group_id=group_id,
        auto_offset_reset="latest",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        connections_max_idle_ms=_IDLE_MS,
        max_poll_interval_ms=max_poll_interval_ms,
    )
