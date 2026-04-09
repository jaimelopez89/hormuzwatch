import json
import os
import ssl
from kafka import KafkaProducer, KafkaConsumer


def _ssl_context():
    ca_path = os.environ["KAFKA_CA_CERT_PATH"]
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(ca_path)
    return ctx


def make_producer():
    return KafkaProducer(
        bootstrap_servers=os.environ["KAFKA_BOOTSTRAP_SERVERS"].split(","),
        security_protocol="SSL",
        ssl_context=_ssl_context(),
        sasl_mechanism=None,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        compression_type="gzip",
        linger_ms=100,
        batch_size=16384,
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
    )
