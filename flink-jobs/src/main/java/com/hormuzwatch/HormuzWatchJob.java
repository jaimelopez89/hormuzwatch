package com.hormuzwatch;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hormuzwatch.detectors.*;
import com.hormuzwatch.models.*;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.serialization.SerializationSchema;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.windowing.assigners.SlidingProcessingTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;

import java.time.Duration;
import java.time.Instant;
import java.util.Properties;

public class HormuzWatchJob {

    public static void main(String[] args) throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        flinkConfig = env.getConfiguration();
        // Note: checkpointing and parallelism are managed by Ververica Cloud deployment config

        Properties kafkaProps = kafkaProperties();
        ObjectMapper mapper = new ObjectMapper();

        // ── Sources ──────────────────────────────────────────────────────────
        DataStream<VesselPosition> positions = kafkaStringSource(env, kafkaProps, "ais-positions")
            .map(s -> { try { return mapper.readValue(s, VesselPosition.class); }
                        catch (Exception e) { return null; } })
            .filter(p -> p != null);

        DataStream<NewsEvent> news = kafkaStringSource(env, kafkaProps, "news-events")
            .map(s -> { try { return mapper.readValue(s, NewsEvent.class); }
                        catch (Exception e) { return null; } })
            .filter(n -> n != null)
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<NewsEvent>forBoundedOutOfOrderness(Duration.ofMinutes(2))
                    .withTimestampAssigner((ev, ts) -> {
                        try { return Instant.parse(ev.publishedAt).toEpochMilli(); }
                        catch (Exception ex) { return Instant.now().toEpochMilli(); }
                    }));

        // ── Existing detectors ───────────────────────────────────────────────
        DataStream<IntelligenceEvent> dark      = positions.keyBy(p -> p.mmsi).process(new DarkAISDetector());
        DataStream<IntelligenceEvent> traffic   = positions.keyBy(p -> "global").process(new TrafficVolumeDetector());
        DataStream<IntelligenceEvent> military  = positions.keyBy(p -> p.mmsi).process(new MilitaryProximityDetector());
        DataStream<IntelligenceEvent> slowdowns = positions.keyBy(p -> p.mmsi).process(new SlowdownDetector());
        DataStream<IntelligenceEvent> clusters  = positions
            .filter(p -> p.shipType >= 80 && p.shipType <= 89)
            .keyBy(p -> gridCell(p.lat, p.lon))
            .window(SlidingProcessingTimeWindows.of(Time.minutes(30), Time.minutes(5)))
            .process(new TankerConcentrationDetector());
        DataStream<IntelligenceEvent> sts       = positions
            .keyBy(p -> String.format("%.1f_%.1f",
                Math.floor(p.lat * 10) / 10, Math.floor(p.lon * 10) / 10))
            .process(new STSRendezvousDetector());
        DataStream<IntelligenceEvent> sanctions = positions.keyBy(p -> p.mmsi).process(new SanctionsHitDetector());

        DataStream<IntelligenceEvent> allAisEvents =
            dark.union(traffic, military, slowdowns, clusters, sts, sanctions)
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<IntelligenceEvent>forBoundedOutOfOrderness(Duration.ofSeconds(30))
                    .withTimestampAssigner((ev, ts) -> {
                        try { return Instant.parse(ev.timestamp).toEpochMilli(); }
                        catch (Exception ex) { return Instant.now().toEpochMilli(); }
                    }));

        DataStream<IntelligenceEvent> correlations = news
            .keyBy(n -> "global")
            .intervalJoin(allAisEvents.keyBy(e -> "global"))
            .between(Time.minutes(-5), Time.minutes(5))
            .process(new NewsAISCorrelator());

        // ── New detectors ────────────────────────────────────────────────────
        DataStream<IntelligenceEvent> multiSignal = MultiSignalCorrelator.apply(allAisEvents);

        DataStream<HeatmapCell>          heatmap      = RiskHeatmapAggregator.apply(allAisEvents);
        DataStream<TrajectoryPrediction> trajectories = TrajectoryPredictor.apply(positions);
        DataStream<FleetEdge>            fleetGraph   = FleetGraphAggregator.apply(positions);
        DataStream<ThroughputSnapshot>   throughput   = ThroughputEstimator.apply(positions);

        // ── Sinks — all output goes to intelligence-events (5-topic limit) ──
        DataStream<IntelligenceEvent> allEvents =
            allAisEvents.union(correlations, multiSignal);
        allEvents.sinkTo(kafkaSink(kafkaProps, "intelligence-events", mapper, IntelligenceEvent.class));

        // Fold specialised types into intelligence-events with a type discriminator
        heatmap.map(h -> {
            IntelligenceEvent ev = new IntelligenceEvent();
            ev.type = "HEATMAP_CELL"; ev.severity = h.severity;
            ev.lat = h.lat; ev.lon = h.lon; ev.timestamp = h.timestamp;
            ev.scoreContribution = h.riskScore;
            try { ev.description = mapper.writeValueAsString(h); } catch (Exception ignored) {}
            return ev;
        }).sinkTo(kafkaSink(kafkaProps, "intelligence-events", mapper, IntelligenceEvent.class));

        trajectories.map(t -> {
            IntelligenceEvent ev = new IntelligenceEvent();
            ev.type = "TRAJECTORY_PREDICTION"; ev.mmsi = t.mmsi;
            if (t.predictedPath != null && !t.predictedPath.isEmpty()) {
                ev.lat = t.predictedPath.get(0)[0]; ev.lon = t.predictedPath.get(0)[1];
            }
            ev.timestamp = t.timestamp;
            try { ev.description = mapper.writeValueAsString(t); } catch (Exception ignored) {}
            return ev;
        }).sinkTo(kafkaSink(kafkaProps, "intelligence-events", mapper, IntelligenceEvent.class));

        fleetGraph.map(f -> {
            IntelligenceEvent ev = new IntelligenceEvent();
            ev.type = "FLEET_EDGE"; ev.mmsi = f.sourceMmsi;
            ev.lat = f.lastLat; ev.lon = f.lastLon; ev.timestamp = f.lastSeen;
            try { ev.description = mapper.writeValueAsString(f); } catch (Exception ignored) {}
            return ev;
        }).sinkTo(kafkaSink(kafkaProps, "intelligence-events", mapper, IntelligenceEvent.class));

        throughput.map(t -> {
            IntelligenceEvent ev = new IntelligenceEvent();
            ev.type = "THROUGHPUT_SNAPSHOT"; ev.timestamp = t.timestamp;
            try { ev.description = mapper.writeValueAsString(t); } catch (Exception ignored) {}
            return ev;
        }).sinkTo(kafkaSink(kafkaProps, "intelligence-events", mapper, IntelligenceEvent.class));

        env.execute("HormuzWatch Intelligence Pipeline v2");
    }

    private static String gridCell(double lat, double lon) {
        return String.format("%.1f_%.1f", Math.floor(lat * 2) / 2, Math.floor(lon * 2) / 2);
    }

    private static String cfg(String key) {
        // 1. Environment variable (e.g. set via OS/container)
        String v = System.getenv(key);
        if (v != null && !v.isEmpty()) return v;
        // 2. JVM system property (e.g. -DKAFKA_BOOTSTRAP_SERVERS=...)
        v = System.getProperty(key, "");
        if (!v.isEmpty()) return v;
        // 3. Flink deployment config — populated from flinkConf in ververica-deployment.yaml
        if (flinkConfig != null) {
            v = flinkConfig.getOptional(
                org.apache.flink.configuration.ConfigOptions.key(key).stringType().noDefaultValue()
            ).orElse("");
        }
        return v != null ? v : "";
    }

    // Flink configuration — populated from deployment flinkConf; set in main() before any cfg() call
    private static org.apache.flink.configuration.ReadableConfig flinkConfig;

    private static Properties kafkaProperties() {
        Properties p = new Properties();
        p.put("bootstrap.servers", cfg("KAFKA_BOOTSTRAP_SERVERS"));
        p.put("security.protocol", "SSL");
        String caCert = loadPem("KAFKA_CA_CERT", "/aiven-ca.pem");
        if (!caCert.isEmpty()) {
            p.put("ssl.truststore.type", "PEM");
            p.put("ssl.truststore.certificates", caCert);
        }
        String clientCert = loadPem("KAFKA_CLIENT_CERT", "/aiven-service.cert");
        String clientKey  = loadPem("KAFKA_CLIENT_KEY",  "/aiven-service.key");
        if (!clientCert.isEmpty() && !clientKey.isEmpty()) {
            p.put("ssl.keystore.type", "PEM");
            p.put("ssl.keystore.certificate.chain", clientCert);
            p.put("ssl.keystore.key", clientKey);
        }
        return p;
    }

    private static String loadPem(String envKey, String classpathResource) {
        String val = cfg(envKey);
        if (!val.isEmpty()) {
            if (!val.startsWith("-----"))
                val = new String(java.util.Base64.getDecoder().decode(val),
                    java.nio.charset.StandardCharsets.UTF_8);
            return val;
        }
        try (java.io.InputStream is = HormuzWatchJob.class.getResourceAsStream(classpathResource)) {
            if (is != null) return new String(is.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception ignored) {}
        return "";
    }

    private static DataStream<String> kafkaStringSource(
            StreamExecutionEnvironment env, Properties props, String topic) {
        KafkaSource<String> src = KafkaSource.<String>builder()
            .setBootstrapServers(props.getProperty("bootstrap.servers"))
            .setTopics(topic).setGroupId("hormuzwatch-flink")
            .setStartingOffsets(OffsetsInitializer.latest())
            .setValueOnlyDeserializer(new SimpleStringSchema())
            .setProperties(props).build();
        return env.fromSource(src, WatermarkStrategy.noWatermarks(), topic);
    }

    private static <T> KafkaSink<T> kafkaSink(Properties props, String topic,
                                               ObjectMapper mapper, Class<T> clazz) {
        return KafkaSink.<T>builder()
            .setBootstrapServers(props.getProperty("bootstrap.servers"))
            .setKafkaProducerConfig(props)
            .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                .setTopic(topic)
                .setValueSerializationSchema((SerializationSchema<T>) ev -> {
                    try { return mapper.writeValueAsBytes(ev); }
                    catch (Exception e) { return new byte[0]; }
                }).build())
            .build();
    }
}
