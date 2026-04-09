package com.hormuzwatch;

import com.hormuzwatch.detectors.DarkAISDetector;
import com.hormuzwatch.models.VesselPosition;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class DarkAISDetectorTest {

    @Test
    public void testDarkEventThresholdIs30Minutes() {
        assertEquals(30 * 60 * 1000L, DarkAISDetector.getDarkThresholdMs());
    }

    @Test
    public void testVesselPositionInStrait() {
        assertTrue(DarkAISDetector.isInStraitCorridor(26.5, 56.3));
    }

    @Test
    public void testVesselPositionOutsideStrait() {
        assertFalse(DarkAISDetector.isInStraitCorridor(51.5, 0.0));   // London
        assertFalse(DarkAISDetector.isInStraitCorridor(22.0, 50.0));  // outside bbox
    }
}
