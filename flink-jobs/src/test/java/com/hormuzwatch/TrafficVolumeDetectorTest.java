package com.hormuzwatch;

import com.hormuzwatch.detectors.TrafficVolumeDetector;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class TrafficVolumeDetectorTest {

    @Test
    public void testAnomalyDetectedWhenCountDrops30Percent() {
        // baseline = 100, current = 60 → -40% → should flag
        assertTrue(TrafficVolumeDetector.isAnomaly(100, 60));
    }

    @Test
    public void testNoAnomalyWithin30PercentThreshold() {
        // baseline = 100, current = 75 → -25% → within threshold
        assertFalse(TrafficVolumeDetector.isAnomaly(100, 75));
    }

    @Test
    public void testAnomalyDetectedWhenCountSurges30Percent() {
        // baseline = 100, current = 140 → +40% → flag
        assertTrue(TrafficVolumeDetector.isAnomaly(100, 140));
    }

    @Test
    public void testNoAnomalyWithZeroBaseline() {
        assertFalse(TrafficVolumeDetector.isAnomaly(0, 50));
    }
}
