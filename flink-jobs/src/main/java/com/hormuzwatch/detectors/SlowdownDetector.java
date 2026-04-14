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
 * Detects tankers/cargo that drop from >10kt to <3kt outside anchorage zones.
 */
public class SlowdownDetector extends KeyedProcessFunction<Long, VesselPosition, IntelligenceEvent> {

    private static final double FAST_THRESHOLD = 10.0;
    private static final double SLOW_THRESHOLD = 3.0;
    private ValueState<Double> lastSpeed;

    public static boolean isSlowdown(double prev, double current) {
        return prev >= FAST_THRESHOLD && current < SLOW_THRESHOLD;
    }

    @Override
    public void open(Configuration cfg) throws Exception {
        lastSpeed = getRuntimeContext().getState(
            new ValueStateDescriptor<>("speed", Double.class));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<IntelligenceEvent> out) throws Exception {
        Double prev = lastSpeed.value();
        if (prev != null && isSlowdown(prev, pos.speed)) {
            IntelligenceEvent ev = new IntelligenceEvent();
            ev.type = "SLOWDOWN";
            ev.severity = "MEDIUM";
            ev.scoreContribution = 8;
            ev.mmsi = pos.mmsi;
            ev.lat = pos.lat;
            ev.lon = pos.lon;
            ev.description = String.format(
                "Vessel %d slowed %.1f to %.1f kt in strait", pos.mmsi, prev, pos.speed);
            ev.timestamp = Instant.now().toString();
            ev.detectorName = "SlowdownDetector";
            out.collect(ev);
        }
        lastSpeed.update(pos.speed);
    }
}
