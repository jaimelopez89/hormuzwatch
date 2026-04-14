package com.hormuzwatch.models;

public class HeatmapCell {
    public String cellId;    // "lat_lon" e.g. "26.0_56.5"
    public double lat;
    public double lon;
    public int eventCount;
    public int riskScore;    // sum of scoreContributions in window
    public String severity;  // highest severity seen in window
    public String timestamp;
}
