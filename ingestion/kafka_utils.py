import json
import logging
import os
import ssl
from kafka import KafkaProducer, KafkaConsumer

# Silence kafka-python loggers.
# kafka.conn logs a spurious ERROR ("Socket EVENT_READ without in-flight-requests")
# whenever the broker closes an idle TCP connection — known kafka-python 2.0.2 bug;
# client recovers automatically. Raise to CRITICAL so it's hidden.
logging.getLogger("kafka").setLevel(logging.WARNING)
logging.getLogger("kafka.conn").setLevel(logging.CRITICAL)

# kafka_utils.py lives one level inside the project root (ingestion/, backend/, etc.)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Close idle connections client-side at 9 min (must be > request_timeout_ms 305s);
# stays under Aiven's ~10 min broker-side idle kill.
_IDLE_MS = 9 * 60 * 1000


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


def make_consumer(topics, group_id):
    return KafkaConsumer(
        *topics,
        bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"].split(","),
        security_protocol="SSL",
        ssl_context=_ssl_context(),
        group_id=group_id,
        auto_offset_reset="latest",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        connections_max_idle_ms=_IDLE_MS,
    )
