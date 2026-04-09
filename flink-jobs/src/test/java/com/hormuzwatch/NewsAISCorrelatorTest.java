package com.hormuzwatch;

import com.hormuzwatch.detectors.NewsAISCorrelator;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class NewsAISCorrelatorTest {

    @Test
    public void testNegativeSentimentNewsIsEscalation() {
        assertTrue(NewsAISCorrelator.isEscalatingNews(-2));
        assertTrue(NewsAISCorrelator.isEscalatingNews(-1));
    }

    @Test
    public void testNeutralNewsIsNotEscalation() {
        assertFalse(NewsAISCorrelator.isEscalatingNews(0));
        assertFalse(NewsAISCorrelator.isEscalatingNews(1));
    }

    @Test
    public void testCorrelationSeverityEscalatesWithCritical() {
        assertEquals("CRITICAL", NewsAISCorrelator.correlatedSeverity("CRITICAL"));
        assertEquals("HIGH", NewsAISCorrelator.correlatedSeverity("HIGH"));
        assertEquals("HIGH", NewsAISCorrelator.correlatedSeverity("MEDIUM"));
    }
}
