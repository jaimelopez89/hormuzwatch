package com.hormuzwatch.detectors;

import com.hormuzwatch.models.HeatmapCell;
import com.hormuzwatch.models.IntelligenceEvent;
import org.apache.flink.api.common.functions.AggregateFunction;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.functions.windowing.ProcessWindowFunction;
import org.apache.flink.streaming.api.windowing.assigners.TumblingProcessingTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;

import java.time.Instant;

public class RiskHeatmapAggregator {

    static class Acc {
        int count = 0;
        int riskScore = 0;
        int maxSevOrd = 0;  // 0=LOW,1=MEDIUM,2=HIGH,3=CRITICAL
        double sumLat = 0;
        double sumLon = 0;
    }

    private static int sevOrd(String s) {
        if ("CRITICAL".equals(s)) return 3;
        if ("HIGH".equals(s))     return 2;
        if ("MEDIUM".equals(s))   return 1;
        return 0;
    }

    private static String sevName(int ord) {
        switch (ord) {
            case 3: return "CRITICAL";
            case 2: return "HIGH";
            case 1: return "MEDIUM";
            default: return "LOW";
        }
    }

    public static DataStream<HeatmapCell> apply(DataStream<IntelligenceEvent> events) {
        return events
            .filter(e -> e.lat != 0 || e.lon != 0)
            .keyBy(e -> String.format("%.1f_%.1f",
                Math.floor(e.lat * 5) / 5,   // 0.2° cell
                Math.floor(e.lon * 5) / 5))
            .window(TumblingProcessingTimeWindows.of(Time.minutes(5)))
            .aggregate(
                new AggregateFunction<IntelligenceEvent, Acc, Acc>() {
                    @Override public Acc createAccumulator() { return new Acc(); }
                    @Override public Acc add(IntelligenceEvent e, Acc a) {
                        a.count++;
                        a.riskScore += e.scoreContribution;
                        a.maxSevOrd = Math.max(a.maxSevOrd, sevOrd(e.severity));
                        a.sumLat += e.lat;
                        a.sumLon += e.lon;
                        return a;
                    }
                    @Override public Acc getResult(Acc a) { return a; }
                    @Override public Acc merge(Acc a, Acc b) {
                        a.count += b.count;
                        a.riskScore += b.riskScore;
                        a.maxSevOrd = Math.max(a.maxSevOrd, b.maxSevOrd);
                        a.sumLat += b.sumLat;
                        a.sumLon += b.sumLon;
                        return a;
                    }
                },
                new ProcessWindowFunction<Acc, HeatmapCell, String, TimeWindow>() {
                    @Override
                    public void process(String key, Context ctx,
                                        Iterable<Acc> in, Collector<HeatmapCell> out) {
                        Acc a = in.iterator().next();
                        if (a.count == 0) return;
                        HeatmapCell cell = new HeatmapCell();
                        cell.cellId = key;
                        cell.lat = a.sumLat / a.count;
                        cell.lon = a.sumLon / a.count;
                        cell.eventCount = a.count;
                        cell.riskScore = a.riskScore;
                        cell.severity = sevName(a.maxSevOrd);
                        cell.timestamp = Instant.now().toString();
                        out.collect(cell);
                    }
                });
    }
}
