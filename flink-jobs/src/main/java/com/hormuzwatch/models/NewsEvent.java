package com.hormuzwatch.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class NewsEvent {
    public String id;
    public String source;
    public String headline;
    public String summary;
    public String url;
    @JsonProperty("published_at")
    public String publishedAt;
    public int sentiment;
}
