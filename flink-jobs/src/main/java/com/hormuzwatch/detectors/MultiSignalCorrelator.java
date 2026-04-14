package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import org.apache.flink.cep.CEP;
import org.apache.flink.cep.PatternSelectFunction;
import org.apache.flink.cep.pattern.Pattern;
import org.apache.flink.cep.pattern.conditions.SimpleCondition;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.windowing.time.Time;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public class MultiSignalCorrelator {

    /**
     * Apply CEP pattern over a timestamped IntelligenceEvent stream.
     * The stream MUST have event-time timestamps and watermarks assigned
     * before calling this method.
     *
     * Pattern: first HIGH/CRITICAL event, then a DIFFERENT detector's
     * HIGH/CRITICAL event within 30 minutes → emit MULTI_SIGNAL_CORRELATED.
     */
    public static DataStream<IntelligenceEvent> apply(
            DataStream<IntelligenceEvent> events) {

        Pattern<IntelligenceEvent, ?> pattern = Pattern
            .<IntelligenceEvent>begin("first")
            .where(new SimpleCondition<IntelligenceEvent>() {
                @Override
                public boolean filter(IntelligenceEvent e) {
                    return "HIGH".equals(e.severity) || "CRITICAL".equals(e.severity);
                }
            })
            .followedBy("second")
            .where(new SimpleCondition<IntelligenceEvent>() {
                @Override
                public boolean filter(IntelligenceEvent e) {
                    return "HIGH".equals(e.severity) || "CRITICAL".equals(e.severity);
                }
            })
            .within(Time.minutes(30));

        return CEP.pattern(events.keyBy(e -> "global"), pattern)
            .select(new PatternSelectFunction<IntelligenceEvent, IntelligenceEvent>() {
                @Override
                public IntelligenceEvent select(Map<String, List<IntelligenceEvent>> match) {
                    IntelligenceEvent first  = match.get("first").get(0);
                    IntelligenceEvent second = match.get("second").get(0);

                    // Skip if same detector fired twice (not truly multi-signal)
                    if (first.detectorName != null &&
                        first.detectorName.equals(second.detectorName)) {
                        return null;
                    }

                    IntelligenceEvent corr = new IntelligenceEvent();
                    corr.type = "MULTI_SIGNAL_CORRELATED";
                    corr.severity = "CRITICAL";
                    corr.scoreContribution = 35;
                    corr.detectorName = "MultiSignalCorrelator";
                    corr.mmsi = first.mmsi;
                    corr.lat = (first.lat + second.lat) / 2;
                    corr.lon = (first.lon + second.lon) / 2;
                    corr.timestamp = Instant.now().toString();
                    corr.description = String.format(
                        "Correlated multi-signal threat: [%s] %s AND [%s] %s within 30 min — elevated confidence",
                        first.type, first.description.substring(0, Math.min(60, first.description.length())),
                        second.type, second.description.substring(0, Math.min(60, second.description.length())));
                    return corr;
                }
            })
            .filter(e -> e != null);
    }
}
