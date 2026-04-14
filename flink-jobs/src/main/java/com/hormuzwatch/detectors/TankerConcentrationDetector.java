package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.streaming.api.functions.windowing.ProcessWindowFunction;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;
import java.time.Instant;

/**
 * Detects 5+ tankers clustered in a 0.5-degree grid cell moving <3kt (waiting/avoiding).
 */
public class TankerConcentrationDetector
        extends ProcessWindowFunction<VesselPosition, IntelligenceEvent, String, TimeWindow> {

    private static final int MIN_CLUSTER_SIZE = 5;
    private static final double MAX_AVG_SPEED_KT = 3.0;

    public static boolean isCluster(int vesselCount, double avgSpeed) {
        return vesselCount >= MIN_CLUSTER_SIZE && avgSpeed < MAX_AVG_SPEED_KT;
    }

    @Override
    public void process(String gridCell, Context ctx,
                        Iterable<VesselPosition> vessels,
                        Collector<IntelligenceEvent> out) {
        int count = 0;
        double totalSpeed = 0;
        double sumLat = 0, sumLon = 0;
        for (VesselPosition v : vessels) {
            // Tanker ship types: 80-89
            if (v.shipType >= 80 && v.shipType <= 89) {
                count++;
                totalSpeed += v.speed;
                sumLat += v.lat;
                sumLon += v.lon;
            }
        }
        if (count == 0) return;
        double avgSpeed = totalSpeed / count;
        if (isCluster(count, avgSpeed)) {
            IntelligenceEvent ev = new IntelligenceEvent();
            ev.type = "TANKER_CLUSTER";
            ev.severity = "MEDIUM";
            ev.scoreContribution = 10;
            ev.lat = sumLat / count;
            ev.lon = sumLon / count;
            ev.description = String.format(
                "%d tankers clustered in grid %s, avg speed %.1f kt", count, gridCell, avgSpeed);
            ev.timestamp = Instant.now().toString();
            ev.detectorName = "TankerConcentrationDetector";
            out.collect(ev);
        }
    }
}
