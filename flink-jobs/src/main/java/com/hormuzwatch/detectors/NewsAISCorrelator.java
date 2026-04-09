package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.NewsEvent;
import org.apache.flink.streaming.api.functions.co.ProcessJoinFunction;
import org.apache.flink.util.Collector;
import java.time.Instant;

/**
 * Temporal join: negative-sentiment news + any HIGH/CRITICAL intelligence event
 * within a 10-minute window → escalation signal.
 */
public class NewsAISCorrelator extends ProcessJoinFunction<NewsEvent, IntelligenceEvent, IntelligenceEvent> {

    public static boolean isEscalatingNews(int sentiment) {
        return sentiment < 0;
    }

    public static String correlatedSeverity(String aisEventSeverity) {
        if ("CRITICAL".equals(aisEventSeverity)) return "CRITICAL";
        return "HIGH";
    }

    @Override
    public void processElement(NewsEvent news, IntelligenceEvent aisEvent,
                               Context ctx, Collector<IntelligenceEvent> out) {
        if (!isEscalatingNews(news.sentiment)) return;
        if (!"HIGH".equals(aisEvent.severity) && !"CRITICAL".equals(aisEvent.severity)) return;

        IntelligenceEvent escalation = new IntelligenceEvent();
        escalation.type = "NEWS_AIS_CORRELATION";
        escalation.severity = correlatedSeverity(aisEvent.severity);
        escalation.scoreContribution = 25;
        escalation.lat = aisEvent.lat;
        escalation.lon = aisEvent.lon;
        escalation.description = String.format(
            "Escalation signal: \"%s\" correlated with %s event (%s)",
            news.headline, aisEvent.type, aisEvent.severity);
        escalation.timestamp = Instant.now().toString();
        escalation.detectorName = "NewsAISCorrelator";
        out.collect(escalation);
    }
}
