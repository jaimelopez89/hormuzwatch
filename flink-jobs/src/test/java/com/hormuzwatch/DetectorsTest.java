package com.hormuzwatch;

import com.hormuzwatch.detectors.*;
import org.junit.jupiter.api.Test;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

public class DetectorsTest {

    // MilitaryProximityDetector
    @Test
    public void testMilitaryShipTypeDetected() {
        assertTrue(MilitaryProximityDetector.isMilitary(35, 123456L, Set.of()));
        assertFalse(MilitaryProximityDetector.isMilitary(80, 123456L, Set.of()));
    }

    @Test
    public void testMilitaryMmsiDetected() {
        assertTrue(MilitaryProximityDetector.isMilitary(0, 422000001L, Set.of(422000001L)));
        assertFalse(MilitaryProximityDetector.isMilitary(0, 999999999L, Set.of()));
    }

    // SlowdownDetector
    @Test
    public void testSlowdownDetected() {
        assertTrue(SlowdownDetector.isSlowdown(12.0, 2.0));  // was 12kt, now 2kt
    }

    @Test
    public void testNoSlowdownWhenAlreadySlow() {
        assertFalse(SlowdownDetector.isSlowdown(2.0, 1.5));
    }

    @Test
    public void testNoSlowdownForSmallSpeedDrop() {
        assertFalse(SlowdownDetector.isSlowdown(12.0, 9.0));
    }

    // TankerConcentrationDetector
    @Test
    public void testClusterDetected() {
        assertTrue(TankerConcentrationDetector.isCluster(6, 1.2));  // 6 tankers, avg speed 1.2kt
    }

    @Test
    public void testNoClusterWhenMoving() {
        assertFalse(TankerConcentrationDetector.isCluster(6, 8.0));  // moving fast
    }

    @Test
    public void testNoClusterWhenTooFewVessels() {
        assertFalse(TankerConcentrationDetector.isCluster(3, 1.0));  // only 3
    }
}
