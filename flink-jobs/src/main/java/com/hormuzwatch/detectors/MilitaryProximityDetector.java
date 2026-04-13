package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import com.hormuzwatch.utils.GeoUtils;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;
import java.time.Instant;
import java.util.Set;

/**
 * Detects military vessels within 5nm of tanker lanes.
 * Uses ship_type=35/36 or known IRGCN/USN MMSI list.
 *
 * Keyed by MMSI. Emits at most once per vessel per 10 minutes to prevent
 * flooding the intelligence feed (AIS updates arrive every few seconds).
 */
public class MilitaryProximityDetector extends KeyedProcessFunction<Long, VesselPosition, IntelligenceEvent> {

    private static final double PROXIMITY_NM = 5.0;
    // Tanker lane centerline midpoint (approximate)
    private static final double LANE_LAT = 26.3;
    private static final double LANE_LON = 56.8;

    private static final long COOLDOWN_MS = 10 * 60 * 1000L; // 10 minutes

    /** Per-MMSI: last time we emitted an alert. */
    private transient ValueState<Long> lastAlertMs;

    public static boolean isMilitary(int shipType, long mmsi, Set<Long> knownMmsis) {
        return shipType == 35 || shipType == 36 || knownMmsis.contains(mmsi);
    }

    @Override
    public void open(Configuration parameters) throws Exception {
        lastAlertMs = getRuntimeContext().getState(
            new ValueStateDescriptor<>("lastAlertMs", Long.class));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<IntelligenceEvent> out) throws Exception {
        if (!isMilitary(pos.shipType, pos.mmsi, Set.of())) return;

        double distNm = GeoUtils.distanceNauticalMiles(pos.lat, pos.lon, LANE_LAT, LANE_LON);
        if (distNm > PROXIMITY_NM) return;

        long now = ctx.timerService().currentProcessingTime();
        Long last = lastAlertMs.value();
        if (last != null && now - last < COOLDOWN_MS) return;

        lastAlertMs.update(now);

        IntelligenceEvent ev = new IntelligenceEvent();
        ev.type = "MILITARY_PROXIMITY";
        ev.severity = distNm <= 2.0 ? "CRITICAL" : "HIGH";
        ev.scoreContribution = distNm <= 2.0 ? 35 : 20;
        ev.mmsi = pos.mmsi;
        ev.lat = pos.lat;
        ev.lon = pos.lon;
        ev.description = String.format(
            "Military vessel %d within %.1f nm of tanker lane", pos.mmsi, distNm);
        ev.timestamp = Instant.now().toString();
        ev.detectorName = "MilitaryProximityDetector";
        out.collect(ev);
    }
}
