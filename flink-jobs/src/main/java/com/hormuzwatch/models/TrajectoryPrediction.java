package com.hormuzwatch.models;

import java.util.List;

public class TrajectoryPrediction {
    public long mmsi;
    public String name;
    public List<double[]> predictedPath;  // [[lat,lon,minutesAhead], ...]
    public double speedKnots;
    public double courseDegs;
    public String timestamp;
}
