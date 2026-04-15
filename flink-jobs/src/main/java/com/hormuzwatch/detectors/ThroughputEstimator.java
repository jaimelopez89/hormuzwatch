package com.hormuzwatch.detectors;

import com.hormuzwatch.models.ThroughputSnapshot;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.typeinfo.PrimitiveArrayTypeInfo;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

public class ThroughputEstimator extends
        KeyedProcessFunction<Long, VesselPosition, ThroughputSnapshot> {

    private static final double CROSSING_LON = 58.0;
    private static final double MIN_LAT = 22.0;
    private static final double MAX_LAT = 27.0;
    // Barrels per day baseline: average VLCC ≈ 2Mbbl/vessel
    private static final long BARRELS_PER_TANKER = 1_000_000L;

    private transient ValueState<Double> lastLon;
    private transient MapState<String, long[]> dailyCounts; // date → [vesselCount, tankerCount, barrelsPerDay]

    @Override
    public void open(Configuration parameters) throws Exception {
        lastLon = getRuntimeContext().getState(
            new ValueStateDescriptor<>("lastLon", Types.DOUBLE));
        dailyCounts = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("dailyCounts", Types.STRING,
                PrimitiveArrayTypeInfo.LONG_PRIMITIVE_ARRAY_TYPE_INFO));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<ThroughputSnapshot> out) throws Exception {
        if (pos.lat < MIN_LAT || pos.lat > MAX_LAT) return;
        if (!((pos.shipType >= 70 && pos.shipType <= 89))) return;

        Double prev = lastLon.value();
        lastLon.update(pos.lon);
        if (prev == null) return;

        boolean westboundCrossing = prev >= CROSSING_LON && pos.lon < CROSSING_LON;
        if (!westboundCrossing) return;

        String today = ZonedDateTime.now(ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_LOCAL_DATE);

        long[] counts = dailyCounts.contains(today) ? dailyCounts.get(today) : new long[]{0, 0, 0};
        counts[0]++;  // vessel count
        boolean isTanker = pos.shipType >= 80 && pos.shipType <= 89;
        if (isTanker) {
            counts[1]++;
            counts[2] += BARRELS_PER_TANKER;
        }
        dailyCounts.put(today, counts);

        ThroughputSnapshot snap = new ThroughputSnapshot();
        snap.date = today;
        snap.vesselCount = (int) counts[0];
        snap.tankerCount = (int) counts[1];
        snap.barrelsPerDay = counts[2];
        snap.westboundTransits = (int) counts[0];
        snap.timestamp = Instant.now().toString();
        out.collect(snap);
    }

    public static DataStream<ThroughputSnapshot> apply(DataStream<VesselPosition> positions) {
        return positions.keyBy(p -> p.mmsi).process(new ThroughputEstimator());
    }
}
