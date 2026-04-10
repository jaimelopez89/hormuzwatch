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
 * SanctionsHitDetector — emits CRITICAL IntelligenceEvent when a vessel MMSI matches
 * OFAC/EU sanctions lists or is a known IRGC-affiliated vessel.
 *
 * Streams must be keyed by MMSI (Long). Emits at most once per vessel per hour
 * to avoid flooding the intelligence feed. Score contribution: 50 points (CRITICAL).
 *
 * Sources:
 *   - OFAC SDN list (Iranian vessels, IRGCN, NIOC-linked tankers)
 *   - Known shadow fleet / dark fleet Iranian tankers
 *   - IRGCN warships and patrol vessels active in Strait of Hormuz
 */
public class SanctionsHitDetector extends KeyedProcessFunction<Long, VesselPosition, IntelligenceEvent> {

    private static final long COOLDOWN_MS = 60 * 60 * 1000L; // 1 hour between re-alerts

    /**
     * Sanctioned MMSIs with annotations:
     *   IR_ = Iranian flag / NIOC-linked
     *   IRGCN_ = Islamic Revolutionary Guard Corps Navy
     *   SF_ = Shadow fleet (foreign flag, Iranian ownership)
     */
    private static final long[] SANCTIONED_MMSIS = {
        // IRGCN warships and patrol vessels
        422000001L, 422000002L, 422000003L, 422000004L, 422000005L,
        271000835L, 271000836L, 271000837L,

        // NIOC / IRISL tankers on OFAC SDN list
        422023900L, 422030700L, 422060300L,
        422100600L, 422112200L, 422134400L,
        422301600L, 422310000L, 422316000L,

        // Shadow fleet — Iranian-owned, foreign-flagged
        657570200L, 657570300L, 657570400L,
        511101390L, 511101394L,  // Cambodia-flagged Iranian tankers
        538007800L, 538008900L,  // Marshall Islands flagged, OFAC-linked
        577305000L,              // Togo-flagged shadow tanker

        // Vessels seized / involved in Hormuz incidents
        352002785L,  // MV Niovi (detained 2022)
        636091798L,  // IRGCN-seized vessel
    };

    private static final String[] SANCTIONED_NAMES = {
        "MEHDI", "OCEAN LION", "JASMINE", "SINA", "HORMUZ",
        "PERSIAN GULF", "PARIZ", "TERMEH", "DUNE", "GULF SKY",
    };

    /** Per-MMSI: last time we emitted an alert (to enforce cooldown). */
    private transient ValueState<Long> lastAlertMs;

    @Override
    public void open(Configuration parameters) throws Exception {
        lastAlertMs = getRuntimeContext().getState(
            new ValueStateDescriptor<>("lastAlertMs", Types.LONG));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<IntelligenceEvent> out) throws Exception {
        if (!isSanctioned(pos.mmsi) && !nameMatchesSanctionsList(pos.name)) {
            return;
        }

        long now = ctx.timerService().currentProcessingTime();
        Long last = lastAlertMs.value();
        if (last != null && now - last < COOLDOWN_MS) {
            return; // cooldown — don't re-alert
        }

        lastAlertMs.update(now);

        String reason = isSanctioned(pos.mmsi)
            ? "MMSI " + pos.mmsi + " appears on OFAC/EU sanctions list"
            : "Vessel name '" + pos.name + "' matches sanctioned vessel";

        IntelligenceEvent event = new IntelligenceEvent();
        event.type = "SANCTIONS_HIT";
        event.severity = "CRITICAL";
        event.scoreContribution = 50;
        event.detectorName = "SanctionsHitDetector";
        event.mmsi = pos.mmsi;
        event.lat = pos.lat;
        event.lon = pos.lon;
        event.timestamp = Instant.now().toString();
        event.description = String.format(
            "SANCTIONED VESSEL DETECTED in Hormuz: %s — %s. Position: %.4f, %.4f",
            pos.name.isEmpty() ? "MMSI " + pos.mmsi : pos.name,
            reason, pos.lat, pos.lon);

        out.collect(event);
    }

    public static boolean isSanctioned(long mmsi) {
        for (long s : SANCTIONED_MMSIS) {
            if (s == mmsi) return true;
        }
        return false;
    }

    private static boolean nameMatchesSanctionsList(String name) {
        if (name == null || name.isBlank()) return false;
        String upper = name.trim().toUpperCase();
        for (String s : SANCTIONED_NAMES) {
            if (upper.contains(s)) return true;
        }
        return false;
    }
}
