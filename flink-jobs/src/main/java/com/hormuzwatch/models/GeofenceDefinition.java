package com.hormuzwatch.models;

public class GeofenceDefinition {
    public String id;
    public String name;
    public String severity;       // HIGH, CRITICAL
    public double[][] polygon;    // [[lon,lat], [lon,lat], ...]
    public boolean active;
}
