package com.hormuzwatch;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hormuzwatch.detectors.*;
import com.hormuzwatch.models.*;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.api.common.serialization.SerializationSchema;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.windowing.assigners.SlidingProcessingTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import java.util.Properties;

public class HormuzWatchJob {

    public static void main(String[] args) throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.enableCheckpointing(60_000);

        Properties kafkaProps = kafkaProperties();
        ObjectMapper mapper = new ObjectMapper();

        // --- Sources ---
        DataStream<VesselPosition> positions = kafkaStringSource(env, kafkaProps, "ais-positions")
            .map(s -> {
                try { return mapper.readValue(s, VesselPosition.class); }
                catch (Exception e) { throw new RuntimeException(e); }
            });

        DataStream<NewsEvent> news = kafkaStringSource(env, kafkaProps, "news-events")
            .map(s -> {
                try { return mapper.readValue(s, NewsEvent.class); }
                catch (Exception e) { throw new RuntimeException(e); }
            });

        // --- Detectors ---
        DataStream<IntelligenceEvent> dark = positions
            .keyBy(p -> p.mmsi)
            .process(new DarkAISDetector());

        DataStream<IntelligenceEvent> traffic = positions
            .keyBy(p -> "global")
            .process(new TrafficVolumeDetector());

        DataStream<IntelligenceEvent> military = positions
            .process(new MilitaryProximityDetector());

        DataStream<IntelligenceEvent> slowdowns = positions
            .keyBy(p -> p.mmsi)
            .process(new SlowdownDetector());

        DataStream<IntelligenceEvent> clusters = positions
            .filter(p -> p.shipType >= 80 && p.shipType <= 89)
            .keyBy(p -> gridCell(p.lat, p.lon))
            .window(SlidingProcessingTimeWindows.of(Time.minutes(30), Time.minutes(5)))
            .process(new TankerConcentrationDetector());

        // Merge all AIS intelligence events
        DataStream<IntelligenceEvent> allAisEvents =
            dark.union(traffic, military, slowdowns, clusters);

        // News x AIS correlation (10-min interval join)
        DataStream<IntelligenceEvent> correlations = news
            .keyBy(n -> "global")
            .intervalJoin(allAisEvents.keyBy(e -> "global"))
            .between(Time.minutes(-5), Time.minutes(5))
            .process(new NewsAISCorrelator());

        DataStream<IntelligenceEvent> allEvents = allAisEvents.union(correlations);

        // --- Sink ---
        allEvents.sinkTo(kafkaSink(kafkaProps, "intelligence-events", mapper));

        env.execute("HormuzWatch Intelligence Pipeline");
    }

    private static String gridCell(double lat, double lon) {
        return String.format("%.1f_%.1f",
            Math.floor(lat * 2) / 2, Math.floor(lon * 2) / 2);
    }

    private static Properties kafkaProperties() {
        Properties p = new Properties();
        p.put("bootstrap.servers", System.getenv("KAFKA_BOOTSTRAP_SERVERS"));
        p.put("security.protocol", "SSL");
        // Support both PEM cert (cloud) and JKS truststore (local)
        String caCert = System.getenv("KAFKA_CA_CERT");
        if (caCert != null && !caCert.isEmpty()) {
            p.put("ssl.truststore.type", "PEM");
            p.put("ssl.truststore.certificates", caCert);
        } else {
            p.put("ssl.truststore.location",
                System.getenv().getOrDefault("KAFKA_TRUSTSTORE_PATH", ""));
            p.put("ssl.truststore.password",
                System.getenv().getOrDefault("KAFKA_TRUSTSTORE_PASSWORD", ""));
        }
        return p;
    }

    private static DataStream<String> kafkaStringSource(
            StreamExecutionEnvironment env, Properties props, String topic) {
        KafkaSource<String> src = KafkaSource.<String>builder()
            .setBootstrapServers(props.getProperty("bootstrap.servers"))
            .setTopics(topic)
            .setGroupId("hormuzwatch-flink")
            .setStartingOffsets(OffsetsInitializer.latest())
            .setValueOnlyDeserializer(new SimpleStringSchema())
            .setProperties(props)
            .build();
        return env.fromSource(src, WatermarkStrategy.noWatermarks(), topic);
    }

    private static KafkaSink<IntelligenceEvent> kafkaSink(
            Properties props, String topic, ObjectMapper mapper) {
        return KafkaSink.<IntelligenceEvent>builder()
            .setBootstrapServers(props.getProperty("bootstrap.servers"))
            .setKafkaProducerConfig(props)
            .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                .setTopic(topic)
                .setValueSerializationSchema((SerializationSchema<IntelligenceEvent>) ev -> {
                    try { return mapper.writeValueAsBytes(ev); }
                    catch (Exception e) { return new byte[0]; }
                })
                .build())
            .build();
    }
}
