import json
import logging
import os
import ssl
import tempfile
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


# Cache the temp file path so we only write it once per process
_ca_tempfile: str | None = None


def _get_ca_path() -> str:
    """Return path to the CA cert file.

    Supports two modes:
      1. KAFKA_CA_CERT_PATH — file path (local dev)
      2. KAFKA_CA_CERT      — PEM string (cloud deploy)
    """
    global _ca_tempfile
    cert_path = os.environ.get("KAFKA_CA_CERT_PATH")
    if cert_path:
        resolved = _resolve(cert_path)
        if not os.path.exists(resolved):
            raise RuntimeError(f"Kafka CA cert not found at {resolved!r}")
        return resolved
    cert_pem = os.environ.get("KAFKA_CA_CERT")
    if cert_pem:
        if _ca_tempfile and os.path.exists(_ca_tempfile):
            return _ca_tempfile
        fd, path = tempfile.mkstemp(suffix=".pem", prefix="kafka-ca-")
        with os.fdopen(fd, "w") as f:
            f.write(cert_pem)
        _ca_tempfile = path
        return path
    raise RuntimeError("Set KAFKA_CA_CERT (PEM string) or KAFKA_CA_CERT_PATH (file path).")


def _ssl_context():
    ca_path = _get_ca_path()
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
