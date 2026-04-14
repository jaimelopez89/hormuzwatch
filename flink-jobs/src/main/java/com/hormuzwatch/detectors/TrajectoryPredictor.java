package com.hormuzwatch.detectors;

import com.hormuzwatch.models.TrajectoryPrediction;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.streaming.api.datastream.DataStream;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public class TrajectoryPredictor {

    private static final double R_NM = 3440.065;

    static double[] project(double lat, double lon, double courseDegs, double distNm) {
        double d = distNm / R_NM;
        double brg = Math.toRadians(courseDegs);
        double lat1 = Math.toRadians(lat);
        double lon1 = Math.toRadians(lon);
        double lat2 = Math.asin(Math.sin(lat1) * Math.cos(d)
                              + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
        double lon2 = lon1 + Math.atan2(
            Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
            Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
        return new double[]{Math.toDegrees(lat2), Math.toDegrees(lon2)};
    }

    public static DataStream<TrajectoryPrediction> apply(DataStream<VesselPosition> positions) {
        return positions
            .filter(p -> p.speed >= 1.0 && p.course >= 0 && p.course <= 360
                      && !Double.isNaN(p.lat) && !Double.isNaN(p.lon))
            .map(new MapFunction<VesselPosition, TrajectoryPrediction>() {
                @Override
                public TrajectoryPrediction map(VesselPosition p) {
                    TrajectoryPrediction pred = new TrajectoryPrediction();
                    pred.mmsi = p.mmsi;
                    pred.name = p.name;
                    pred.speedKnots = p.speed;
                    pred.courseDegs = p.course;
                    pred.timestamp = Instant.now().toString();
                    pred.predictedPath = new ArrayList<>();

                    int[] mins = {15, 30, 45, 60, 90, 120};
                    for (int m : mins) {
                        double distNm = p.speed * (m / 60.0);
                        double[] pos = project(p.lat, p.lon, p.course, distNm);
                        pred.predictedPath.add(new double[]{pos[0], pos[1], m});
                    }
                    return pred;
                }
            });
    }
}
