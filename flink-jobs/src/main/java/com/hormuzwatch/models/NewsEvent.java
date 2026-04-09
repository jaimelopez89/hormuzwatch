package com.hormuzwatch.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class NewsEvent {
    public String id;
    public String source;
    public String headline;
    public String summary;
    public String url;
    public String publishedAt;
    public int sentiment;
}
