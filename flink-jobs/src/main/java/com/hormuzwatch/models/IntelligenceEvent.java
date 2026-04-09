package com.hormuzwatch.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class IntelligenceEvent {
    public String type;        // DARK_AIS, TRAFFIC_ANOMALY, MILITARY_PROXIMITY, etc.
    public String severity;    // CRITICAL, HIGH, MEDIUM, LOW
    public int scoreContribution;
    public String description;
    public long mmsi;
    public double lat;
    public double lon;
    public String timestamp;
    public String detectorName;
}
