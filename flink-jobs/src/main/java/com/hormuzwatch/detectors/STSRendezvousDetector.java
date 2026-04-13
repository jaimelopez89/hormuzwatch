package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import com.hormuzwatch.utils.GeoUtils;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;

import java.time.Instant;

/**
 * STSRendezvousDetector — detects ship-to-ship (STS) transfer operations.
 *
 * A rendezvous is flagged when two tankers or cargo vessels are:
 *   - Within 0.5 nautical miles of each other
 *   - Both moving at less than 3 knots
 *   - Not in a known anchorage zone
 *
 * The stream must be keyed by grid cell (0.1° resolution) before applying this function.
 * Emits CRITICAL if one vessel has known sanctioned MMSI, HIGH otherwise.
 */
public class STSRendezvousDetector extends KeyedProcessFunction<String, VesselPosition, IntelligenceEvent> {

    private static final double RENDEZVOUS_NM = 0.5;
    private static final double SLOW_KNOTS = 3.0;

    // Known anchorage zones (lat_center, lon_center, radius_nm)
    private static final double[][] ANCHORAGES = {
        {25.34, 55.43, 2.0},  // Fujairah anchorage
        {26.98, 56.08, 3.0},  // Bandar Abbas
        {26.64, 53.97, 2.0},  // Qeshm
    };

    // Sanctioned vessel MMSIs (IRGC-linked, OFAC-listed)
    private static final long[] SANCTIONED_MMSIS = {
        271000835L, 271000836L, 271000837L,  // IRGCN vessels
        422023900L, 422030700L, 422060300L,  // Iranian tankers under sanctions
        657570200L, 657570300L,              // Iranian flagged shadow fleet
    };

    private transient MapState<Long, VesselPosition> nearbyVessels;

    @Override
    public void open(Configuration parameters) throws Exception {
        nearbyVessels = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("nearbyVessels", Types.LONG,
                Types.GENERIC(VesselPosition.class)));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<IntelligenceEvent> out) throws Exception {
        if (pos.speed > SLOW_KNOTS) {
            nearbyVessels.remove(pos.mmsi);
            return;
        }
        if (isInAnchorage(pos.lat, pos.lon)) {
            nearbyVessels.remove(pos.mmsi);
            return;
        }

        // Check against all other slow vessels in the same grid cell
        for (java.util.Map.Entry<Long, VesselPosition> entry : nearbyVessels.entries()) {
            if (entry.getKey() == pos.mmsi) continue;
            VesselPosition other = entry.getValue();
            double dist = GeoUtils.distanceNauticalMiles(pos.lat, pos.lon, other.lat, other.lon);
            if (dist <= RENDEZVOUS_NM) {
                boolean sanctioned = isSanctioned(pos.mmsi) || isSanctioned(other.mmsi);
                IntelligenceEvent event = new IntelligenceEvent();
                event.type = "STS_RENDEZVOUS";
                event.severity = sanctioned ? "CRITICAL" : "HIGH";
                event.scoreContribution = sanctioned ? 40 : 20;
                event.detectorName = "STSRendezvousDetector";
                event.mmsi = pos.mmsi;
                event.lat = (pos.lat + other.lat) / 2;
                event.lon = (pos.lon + other.lon) / 2;
                event.timestamp = Instant.now().toString();
                event.description = String.format(
                    "Possible STS transfer: vessel %d and %d within %.2fnm at <3kt%s",
                    pos.mmsi, other.mmsi, dist,
                    sanctioned ? " — SANCTIONED VESSEL INVOLVED" : "");
                out.collect(event);
            }
        }

        nearbyVessels.put(pos.mmsi, pos);

        // Register cleanup timer (evict stale entries after 10 min)
        ctx.timerService().registerProcessingTimeTimer(
            ctx.timerService().currentProcessingTime() + 10 * 60 * 1000L);
    }

    @Override
    public void onTimer(long timestamp, OnTimerContext ctx,
                        Collector<IntelligenceEvent> out) throws Exception {
        long cutoff = timestamp - 10 * 60 * 1000L;
        // Collect stale keys first — cannot remove while iterating MapState
        java.util.List<Long> toRemove = new java.util.ArrayList<>();
        for (java.util.Map.Entry<Long, VesselPosition> entry : nearbyVessels.entries()) {
            try {
                long lastSeen = java.time.Instant.parse(entry.getValue().timestamp)
                    .toEpochMilli();
                if (lastSeen < cutoff) toRemove.add(entry.getKey());
            } catch (Exception ignored) {}
        }
        for (Long key : toRemove) nearbyVessels.remove(key);
    }

    public static boolean isSanctioned(long mmsi) {
        for (long s : SANCTIONED_MMSIS) {
            if (s == mmsi) return true;
        }
        return false;
    }

    private static boolean isInAnchorage(double lat, double lon) {
        for (double[] a : ANCHORAGES) {
            if (GeoUtils.distanceNauticalMiles(lat, lon, a[0], a[1]) <= a[2]) return true;
        }
        return false;
    }
}
