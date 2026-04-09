package com.hormuzwatch.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class VesselPosition {
    public long mmsi;
    public String name = "";
    public double lat;
    public double lon;
    public double speed;
    public double course;
    public int heading;
    @JsonProperty("nav_status")
    public int navStatus;
    @JsonProperty("ship_type")
    public int shipType;
    public String flag = "";
    public String timestamp;
}
