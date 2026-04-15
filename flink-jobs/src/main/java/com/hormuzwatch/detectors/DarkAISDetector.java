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
 * corridor stops transmitting AIS for an extended period.
 *
 * False-positive reduction vs the naïve 30-minute version:
 *
 *   1. Threshold raised to 4 hours — terrestrial AIS coverage in the Gulf has
 *      known gaps; a 30-min gap is usually receiver noise, not intentional shutoff.
 *
 *   2. Minimum observations — the vessel must have sent ≥ 5 position reports
 *      before we track it. This removes single satellite-AIS hits that create
 *      phantom "dark" events when the satellite pass ends.
 *
 *   3. Must have been moving — stationary/anchored vessels (last speed < 0.5 kt)
 *      legitimately reduce their AIS transmission rate; we don't flag them.
 *
 *   4. Commercial and military only — tanker (80-89), cargo (70-79), military (35-36).
 *      Fishing boats, pleasure craft, and unknown types are ignored.
 *
 *   5. Re-alert period raised to 12 hours — if a vessel stays dark we don't need
 *      an alert every 30 minutes; one alert per half-day is sufficient.
 *
 * The stream must be keyed by MMSI (Long) before applying this function.
 */
public class DarkAISDetector extends KeyedProcessFunction<Long, VesselPosition, IntelligenceEvent> {

    private static final long   DARK_THRESHOLD_MS   = 4 * 60 * 60 * 1000L;  // 4 hours
    private static final long   REALERT_MS           = 12 * 60 * 60 * 1000L; // re-alert every 12 h
    private static final int    MIN_OBSERVATIONS     = 5;                     // need 5 reports before tracking
    private static final double MIN_SPEED_KT         = 0.5;                   // must have been underway

    private transient ValueState<Long>    lastSeenMs;
    private transient ValueState<Long>    timerId;
    private transient ValueState<Double>  lastLat;
    private transient ValueState<Double>  lastLon;
    private transient ValueState<Double>  lastSpeed;
    private transient ValueState<Integer> observationCount;

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
        lastSpeed = getRuntimeContext().getState(
                new ValueStateDescriptor<>("lastSpeed", Types.DOUBLE));
        observationCount = getRuntimeContext().getState(
                new ValueStateDescriptor<>("observationCount", Types.INT));
    }

    @Override
    public void processElement(VesselPosition position,
                               Context ctx,
                               Collector<IntelligenceEvent> out) throws Exception {

        // Only track vessels we care about
        if (!isTrackedType(position.shipType)) return;

        long now = ctx.timerService().currentProcessingTime();

        // Increment observation counter
        Integer count = observationCount.value();
        int newCount = (count == null ? 0 : count) + 1;
        observationCount.update(newCount);

        // Cancel previous timer
        Long prevTimer = timerId.value();
        if (prevTimer != null) {
            ctx.timerService().deleteProcessingTimeTimer(prevTimer);
        }

        // Update state
        lastSeenMs.update(now);
        lastLat.update(position.lat);
        lastLon.update(position.lon);
        lastSpeed.update(position.speed);

        // Only arm the timer once we have enough observations
        if (newCount >= MIN_OBSERVATIONS) {
            long fireAt = now + DARK_THRESHOLD_MS;
            ctx.timerService().registerProcessingTimeTimer(fireAt);
            timerId.update(fireAt);
        }
    }

    @Override
    public void onTimer(long timestamp,
                        OnTimerContext ctx,
                        Collector<IntelligenceEvent> out) throws Exception {
        Long registered = timerId.value();
        if (registered == null || registered != timestamp) return;

        double lat   = lastLat.value()   != null ? lastLat.value()   : 0.0;
        double lon   = lastLon.value()   != null ? lastLon.value()   : 0.0;
        double speed = lastSpeed.value() != null ? lastSpeed.value() : 0.0;

        // Skip vessels that were stationary when last seen — they legitimately transmit less
        if (speed < MIN_SPEED_KT) {
            timerId.clear();
            return;
        }

        // Only emit if vessel was last seen inside the strait corridor
        if (!isInStraitCorridor(lat, lon)) {
            timerId.clear();
            return;
        }

        long mmsi = ctx.getCurrentKey();

        IntelligenceEvent event = new IntelligenceEvent();
        event.type            = "DARK_AIS";
        event.severity        = "HIGH";
        event.scoreContribution = 12;
        event.detectorName    = "DarkAISDetector";
        event.mmsi            = mmsi;
        event.lat             = lat;
        event.lon             = lon;
        event.timestamp       = Instant.ofEpochMilli(timestamp).toString();
        event.description     = "Vessel " + mmsi + " has gone dark (no AIS for >4h) "
                + "in the Strait of Hormuz corridor — was underway at " + String.format("%.1f", speed) + " kt.";
        out.collect(event);

        // Re-arm for 12-hour follow-up if vessel remains dark
        long nextFire = timestamp + REALERT_MS;
        ctx.timerService().registerProcessingTimeTimer(nextFire);
        timerId.update(nextFire);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    public static long getDarkThresholdMs() { return DARK_THRESHOLD_MS; }

    /**
     * Returns true if the given lat/lon falls within the bounding box that covers
     * the Strait of Hormuz navigable corridor, extended slightly to capture
     * vessels that go dark just before or after the narrows.
     *
     * Bounding box: lat [25.0, 27.5], lon [55.5, 59.0]
     */
    public static boolean isInStraitCorridor(double lat, double lon) {
        return lat >= 25.0 && lat <= 27.5 && lon >= 55.5 && lon <= 59.0;
    }

    /**
     * Returns true for vessel types worth tracking for dark-AIS:
     * tanker (80-89), cargo (70-79), military/law enforcement (35, 36).
     */
    private static boolean isTrackedType(int shipType) {
        return (shipType >= 70 && shipType <= 89)
            || shipType == 35
            || shipType == 36;
    }
}
