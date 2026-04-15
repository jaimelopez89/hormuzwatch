package com.hormuzwatch.detectors;

import com.hormuzwatch.models.FleetEdge;
import com.hormuzwatch.models.VesselPosition;
import com.hormuzwatch.utils.GeoUtils;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;

import java.time.Instant;

public class FleetGraphAggregator extends
        KeyedProcessFunction<String, VesselPosition, FleetEdge> {

    private static final double PROXIMITY_NM = 2.0;
    private transient MapState<Long, VesselPosition> cellVessels;
    private transient MapState<String, Integer> edgeCounts;

    @Override
    public void open(Configuration parameters) throws Exception {
        cellVessels = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("cellVessels", Types.LONG,
                Types.GENERIC(VesselPosition.class)));
        edgeCounts = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("edgeCounts", Types.STRING, Types.INT));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<FleetEdge> out) throws Exception {
        for (java.util.Map.Entry<Long, VesselPosition> entry : cellVessels.entries()) {
            if (entry.getKey() == pos.mmsi) continue;
            VesselPosition other = entry.getValue();
            double dist = GeoUtils.distanceNauticalMiles(pos.lat, pos.lon, other.lat, other.lon);
            if (dist > PROXIMITY_NM) continue;

            long a = Math.min(pos.mmsi, other.mmsi);
            long b = Math.max(pos.mmsi, other.mmsi);
            String edgeKey = a + ":" + b;
            int count = edgeCounts.contains(edgeKey) ? edgeCounts.get(edgeKey) : 0;
            count++;
            edgeCounts.put(edgeKey, count);

            FleetEdge edge = new FleetEdge();
            edge.sourceMmsi = a;
            edge.targetMmsi = b;
            edge.proximityCount = count;
            edge.lastLat = (pos.lat + other.lat) / 2;
            edge.lastLon = (pos.lon + other.lon) / 2;
            edge.lastSeen = Instant.now().toString();
            out.collect(edge);
        }
        cellVessels.put(pos.mmsi, pos);

        ctx.timerService().registerProcessingTimeTimer(
            ctx.timerService().currentProcessingTime() + 30 * 60 * 1000L);
    }

    @Override
    public void onTimer(long ts, OnTimerContext ctx, Collector<FleetEdge> out) throws Exception {
        long cutoff = ts - 30 * 60 * 1000L;
        java.util.List<Long> stale = new java.util.ArrayList<>();
        for (java.util.Map.Entry<Long, VesselPosition> e : cellVessels.entries()) {
            try {
                if (java.time.Instant.parse(e.getValue().timestamp).toEpochMilli() < cutoff)
                    stale.add(e.getKey());
            } catch (Exception ignored) {}
        }
        for (Long k : stale) cellVessels.remove(k);
    }

    public static DataStream<FleetEdge> apply(DataStream<VesselPosition> positions) {
        return positions
            .keyBy(p -> String.format("%.1f_%.1f",
                Math.floor(p.lat * 5) / 5,
                Math.floor(p.lon * 5) / 5))
            .process(new FleetGraphAggregator());
    }
}
