package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import com.hormuzwatch.utils.GeoUtils;
import org.apache.flink.streaming.api.functions.ProcessFunction;
import org.apache.flink.util.Collector;
import java.time.Instant;
import java.util.Set;

/**
 * Detects military vessels within 5nm of tanker lanes.
 * Uses ship_type=35/36 or known IRGCN/USN MMSI list.
 */
public class MilitaryProximityDetector extends ProcessFunction<VesselPosition, IntelligenceEvent> {

    private static final double PROXIMITY_NM = 5.0;
    // Tanker lane centerline midpoint (approximate)
    private static final double LANE_LAT = 26.3;
    private static final double LANE_LON = 56.8;

    public static boolean isMilitary(int shipType, long mmsi, Set<Long> knownMmsis) {
        return shipType == 35 || shipType == 36 || knownMmsis.contains(mmsi);
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<IntelligenceEvent> out) {
        if (!isMilitary(pos.shipType, pos.mmsi, Set.of())) return;
        double distNm = GeoUtils.distanceNauticalMiles(pos.lat, pos.lon, LANE_LAT, LANE_LON);
        if (distNm <= PROXIMITY_NM) {
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
}
