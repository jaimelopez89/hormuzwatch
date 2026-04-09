package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;

import java.time.Instant;

/**
 * DarkAISDetector — emits an IntelligenceEvent when a vessel in the Strait of Hormuz
 * corridor has not transmitted an AIS position for more than 30 minutes.
 *
 * The stream must be keyed by MMSI (Long) before applying this function.
 */
public class DarkAISDetector extends KeyedProcessFunction<Long, VesselPosition, IntelligenceEvent> {

    private static final long DARK_THRESHOLD_MS = 30 * 60 * 1000L; // 30 minutes

    /** Last position seen for this MMSI (processing time, ms). */
    private transient ValueState<Long> lastSeenMs;

    /** Timer ID currently registered for this MMSI. */
    private transient ValueState<Long> timerId;

    /** Last known lat/lon for the MMSI (used when the timer fires). */
    private transient ValueState<Double> lastLat;
    private transient ValueState<Double> lastLon;

    @Override
    public void open(Configuration parameters) throws Exception {
        lastSeenMs = getRuntimeContext().getState(
                new ValueStateDescriptor<>("lastSeenMs", Types.LONG));
        timerId = getRuntimeContext().getState(
                new ValueStateDescriptor<>("timerId", Types.LONG));
        lastLat = getRuntimeContext().getState(
                new ValueStateDescriptor<>("lastLat", Types.DOUBLE));
        lastLon = getRuntimeContext().getState(
                new ValueStateDescriptor<>("lastLon", Types.DOUBLE));
    }

    @Override
    public void processElement(VesselPosition position,
                               Context ctx,
                               Collector<IntelligenceEvent> out) throws Exception {
        long now = ctx.timerService().currentProcessingTime();

        // Cancel previously registered timer (if any)
        Long prevTimer = timerId.value();
        if (prevTimer != null) {
            ctx.timerService().deleteProcessingTimeTimer(prevTimer);
        }

        // Update last-seen state
        lastSeenMs.update(now);
        lastLat.update(position.lat);
        lastLon.update(position.lon);

        // Register a new timer 30 minutes from now
        long fireAt = now + DARK_THRESHOLD_MS;
        ctx.timerService().registerProcessingTimeTimer(fireAt);
        timerId.update(fireAt);
    }

    @Override
    public void onTimer(long timestamp,
                        OnTimerContext ctx,
                        Collector<IntelligenceEvent> out) throws Exception {
        Long registered = timerId.value();
        // Guard: only act if this is the timer we last registered
        if (registered == null || registered != timestamp) {
            return;
        }

        double lat = lastLat.value() != null ? lastLat.value() : 0.0;
        double lon = lastLon.value() != null ? lastLon.value() : 0.0;

        // Only emit if vessel was last seen inside the strait corridor
        if (!isInStraitCorridor(lat, lon)) {
            return;
        }

        long mmsi = ctx.getCurrentKey();

        IntelligenceEvent event = new IntelligenceEvent();
        event.type = "DARK_AIS";
        event.severity = "HIGH";
        event.scoreContribution = 12;
        event.detectorName = "DarkAISDetector";
        event.mmsi = mmsi;
        event.lat = lat;
        event.lon = lon;
        event.timestamp = Instant.ofEpochMilli(timestamp).toString();
        event.description = "Vessel " + mmsi + " has gone dark (no AIS signal for >30 min) "
                + "in the Strait of Hormuz corridor.";

        out.collect(event);

        // Re-register timer so we keep alerting if silence continues
        long nextFire = timestamp + DARK_THRESHOLD_MS;
        ctx.timerService().registerProcessingTimeTimer(nextFire);
        timerId.update(nextFire);
    }

    // -------------------------------------------------------------------------
    // Static helpers (used by tests and stream wiring)
    // -------------------------------------------------------------------------

    /** Returns the dark-AIS detection threshold in milliseconds (30 minutes). */
    public static long getDarkThresholdMs() {
        return DARK_THRESHOLD_MS;
    }

    /**
     * Returns true if the given lat/lon falls within the bounding box that covers
     * the Strait of Hormuz navigable corridor.
     *
     * Bounding box: lat [25.5, 27.2], lon [55.8, 58.0]
     */
    public static boolean isInStraitCorridor(double lat, double lon) {
        return lat >= 25.5 && lat <= 27.2 && lon >= 55.8 && lon <= 58.0;
    }
}
