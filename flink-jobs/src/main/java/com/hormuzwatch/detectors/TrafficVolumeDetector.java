package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import java.time.Instant;

/**
 * 1-hour tumbling count of vessels in Hormuz bbox.
 * Fires HIGH/MEDIUM alert when count deviates >30% from rolling baseline.
 */
public class TrafficVolumeDetector extends KeyedProcessFunction<String, VesselPosition, IntelligenceEvent> {

    private static final double ANOMALY_THRESHOLD = 0.30;
    private static final long WINDOW_MS = 3_600_000L; // 1 hour

    private ValueState<Long> windowCount;
    private ValueState<Double> baseline;
    private ValueState<Long> windowStart;

    public static boolean isAnomaly(double baseline, long current) {
        if (baseline <= 0) return false;
        double deviation = Math.abs((current - baseline) / baseline);
        return deviation >= ANOMALY_THRESHOLD;
    }

    @Override
    public void open(Configuration cfg) throws Exception {
        windowCount = getRuntimeContext().getState(
            new ValueStateDescriptor<>("count", Long.class));
        baseline = getRuntimeContext().getState(
            new ValueStateDescriptor<>("baseline", Double.class));
        windowStart = getRuntimeContext().getState(
            new ValueStateDescriptor<>("windowStart", Long.class));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<IntelligenceEvent> out) throws Exception {
        long now = ctx.timerService().currentProcessingTime();
        Long ws = windowStart.value();

        if (ws == null) {
            windowStart.update(now);
            windowCount.update(1L);
            return;
        }

        if (now - ws > WINDOW_MS) {
            long count = windowCount.value() == null ? 0L : windowCount.value();
            Double base = baseline.value();
            if (base != null && isAnomaly(base, count)) {
                IntelligenceEvent ev = new IntelligenceEvent();
                ev.type = "TRAFFIC_ANOMALY";
                ev.severity = count < base ? "HIGH" : "MEDIUM";
                ev.scoreContribution = 15;
                ev.description = String.format(
                    "Vessel count %d vs baseline %.0f (%.0f%% deviation)",
                    count, base, Math.abs((count - base) / base * 100));
                ev.lat = 26.5;
                ev.lon = 56.3;
                ev.timestamp = Instant.now().toString();
                ev.detectorName = "TrafficVolumeDetector";
                out.collect(ev);
            }
            // Update rolling baseline (EMA: 90% old, 10% new)
            baseline.update(base == null ? (double) count : base * 0.9 + count * 0.1);
            windowStart.update(now);
            windowCount.update(1L);
        } else {
            long prev = windowCount.value() == null ? 0L : windowCount.value();
            windowCount.update(prev + 1);
            if (baseline.value() == null) baseline.update(0.0);
        }
    }
}
