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
 *   - Within 0.3 nautical miles of each other (actual alongside distance)
 *   - Both essentially stationary (< 0.5 knots)
 *   - Both are commercial vessel types (tanker or cargo, ship_type 70-89)
 *   - Not in a known anchorage or transit-waiting zone
 *   - Not moored, at anchor, or aground (navStatus 1/5/6)
 *   - No alert has fired for this pair in the last 6 hours
 *
 * Tuned to avoid false positives from vessels awaiting strait passage, which
 * cluster in the outer anchorage zones at low speed but are not doing STS.
 *
 * The stream must be keyed by grid cell (0.1° resolution) before applying this function.
 * Emits CRITICAL if one vessel has known sanctioned MMSI, HIGH otherwise.
 */
public class STSRendezvousDetector extends KeyedProcessFunction<String, VesselPosition, IntelligenceEvent> {

    private static final double RENDEZVOUS_NM   = 0.3;                    // ~550 m — actual alongside distance
    private static final double SLOW_KNOTS       = 0.5;                    // essentially stationary
    private static final long   COOLDOWN_MS      = 6 * 60 * 60 * 1000L;   // 6 h per pair
    private static final long   ALERT_RETENTION_MS = 12 * 60 * 60 * 1000L; // clean up after 12 h

    // AIS nav-status codes that indicate a stationary/berthed vessel — not a transfer operation
    // 1=At anchor, 5=Moored, 6=Aground
    private static final int NAV_AT_ANCHOR = 1;
    private static final int NAV_MOORED    = 5;
    private static final int NAV_AGROUND   = 6;

    // Known anchorage and transit-waiting zones (lat_center, lon_center, radius_nm).
    // Radii are intentionally generous — ships awaiting passage cluster far offshore.
    private static final double[][] ANCHORAGES = {
        {25.34, 55.43, 6.0},  // Fujairah outer anchorage (very large waiting area)
        {25.37, 56.36, 4.0},  // Khor Fakkan outer anchorage
        {26.98, 56.08, 5.0},  // Bandar Abbas approaches
        {26.64, 53.97, 3.0},  // Qeshm
        {26.84, 56.42, 4.0},  // Larak Island — strait entry waiting area
        {26.65, 55.88, 3.5},  // Hengam Island — strait passage queue
        {26.35, 56.60, 3.0},  // Strait of Hormuz inbound lane holding
        {25.07, 55.13, 3.0},  // Dubai / Port Rashid
        {24.47, 54.37, 3.5},  // Abu Dhabi
        {23.63, 58.59, 3.0},  // Muscat / Port Sultan Qaboos
        {26.19, 50.62, 3.0},  // Bahrain / Khalifa Bin Salman Port
        {29.37, 47.98, 4.0},  // Kuwait anchorage
        {29.07, 48.58, 3.0},  // Mina Al Ahmadi (Kuwait)
        {27.17, 49.67, 3.0},  // Ras Tanura (Saudi Arabia)
        {25.27, 50.62, 3.0},  // Bahrain outer anchorage
    };

    // Sanctioned vessel MMSIs (IRGC-linked, OFAC-listed)
    private static final long[] SANCTIONED_MMSIS = {
        271000835L, 271000836L, 271000837L,  // IRGCN vessels
        422023900L, 422030700L, 422060300L,  // Iranian tankers under sanctions
        657570200L, 657570300L,              // Iranian flagged shadow fleet
    };

    private transient MapState<Long, VesselPosition> nearbyVessels;
    // Tracks last alert time per pair to enforce cooldown.
    // Key = "minMmsi:maxMmsi"; value = System.currentTimeMillis() at last alert.
    private transient MapState<String, Long> lastAlertTimes;

    @Override
    public void open(Configuration parameters) throws Exception {
        nearbyVessels = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("nearbyVessels", Types.LONG,
                Types.GENERIC(VesselPosition.class)));
        lastAlertTimes = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("lastAlertTimes", Types.STRING, Types.LONG));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<IntelligenceEvent> out) throws Exception {
        // Only track commercial vessels (tanker=80-89, cargo=70-79).
        // Military, fishing, pleasure craft, etc. are not doing STS cargo transfers.
        if (!isCommercialVessel(pos.shipType)) {
            nearbyVessels.remove(pos.mmsi);
            return;
        }
        // Speed guard — must be essentially stationary
        if (pos.speed > SLOW_KNOTS) {
            nearbyVessels.remove(pos.mmsi);
            return;
        }
        // Nav-status guard: skip vessels that are officially stationary
        if (isStationaryStatus(pos.navStatus)) {
            nearbyVessels.remove(pos.mmsi);
            return;
        }
        // Anchorage guard
        if (isInAnchorage(pos.lat, pos.lon)) {
            nearbyVessels.remove(pos.mmsi);
            return;
        }

        long now = System.currentTimeMillis();

        // Check against all other slow vessels in the same grid cell
        for (java.util.Map.Entry<Long, VesselPosition> entry : nearbyVessels.entries()) {
            if (entry.getKey() == pos.mmsi) continue;
            VesselPosition other = entry.getValue();

            // Skip if the other vessel has since gone stationary
            if (isStationaryStatus(other.navStatus) || isInAnchorage(other.lat, other.lon)) {
                continue;
            }

            double dist = GeoUtils.distanceNauticalMiles(pos.lat, pos.lon, other.lat, other.lon);
            if (dist > RENDEZVOUS_NM) continue;

            // Cooldown check: skip if we already fired for this pair recently
            String pairKey = Math.min(pos.mmsi, other.mmsi) + ":" + Math.max(pos.mmsi, other.mmsi);
            Long lastAlert = lastAlertTimes.get(pairKey);
            if (lastAlert != null && now - lastAlert < COOLDOWN_MS) continue;

            lastAlertTimes.put(pairKey, now);

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

        nearbyVessels.put(pos.mmsi, pos);

        // Register cleanup timer (evict stale entries after 10 min)
        ctx.timerService().registerProcessingTimeTimer(
            ctx.timerService().currentProcessingTime() + 10 * 60 * 1000L);
    }

    @Override
    public void onTimer(long timestamp, OnTimerContext ctx,
                        Collector<IntelligenceEvent> out) throws Exception {
        long vesselCutoff = timestamp - 10 * 60 * 1000L;
        long alertCutoff  = timestamp - ALERT_RETENTION_MS;

        // Evict stale vessel entries
        java.util.List<Long> toRemove = new java.util.ArrayList<>();
        for (java.util.Map.Entry<Long, VesselPosition> entry : nearbyVessels.entries()) {
            try {
                long lastSeen = java.time.Instant.parse(entry.getValue().timestamp)
                    .toEpochMilli();
                if (lastSeen < vesselCutoff) toRemove.add(entry.getKey());
            } catch (Exception ignored) {}
        }
        for (Long key : toRemove) nearbyVessels.remove(key);

        // Evict old cooldown entries
        java.util.List<String> pairsToRemove = new java.util.ArrayList<>();
        for (java.util.Map.Entry<String, Long> entry : lastAlertTimes.entries()) {
            if (entry.getValue() < alertCutoff) pairsToRemove.add(entry.getKey());
        }
        for (String key : pairsToRemove) lastAlertTimes.remove(key);
    }

    public static boolean isSanctioned(long mmsi) {
        for (long s : SANCTIONED_MMSIS) {
            if (s == mmsi) return true;
        }
        return false;
    }

    private static boolean isStationaryStatus(int navStatus) {
        return navStatus == NAV_AT_ANCHOR || navStatus == NAV_MOORED || navStatus == NAV_AGROUND;
    }

    private static boolean isInAnchorage(double lat, double lon) {
        for (double[] a : ANCHORAGES) {
            if (GeoUtils.distanceNauticalMiles(lat, lon, a[0], a[1]) <= a[2]) return true;
        }
        return false;
    }

    /** Returns true for tanker (80-89) and cargo (70-79) vessel types. */
    private static boolean isCommercialVessel(int shipType) {
        return (shipType >= 70 && shipType <= 89);
    }
}
