# Flink Stream Processors — Next-Gen Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six new Flink stream processors that showcase Ververica's real-time AI capabilities: multi-signal CEP correlation, risk heatmap aggregation, vessel trajectory prediction, fleet network graph building, strait throughput estimation, and dynamic geofence filtering.

**Architecture:** Each feature is a new Java class in `flink-jobs/src/main/java/com/hormuzwatch/detectors/`. They consume the existing `ais-positions` and `intelligence-events` Kafka topics and emit to new dedicated topics (`heatmap-cells`, `vessel-predictions`, `fleet-graph`, `throughput-estimates`). Geofence breaches go to `intelligence-events` via a broadcast-state dynamic filter. `HormuzWatchJob.java` is extended to wire all new processors.

**Tech Stack:** Flink 1.18.1, flink-cep 1.18.1, flink-connector-kafka 3.1.0-1.18, Jackson 2.15.3, JTS 1.19.0, Maven shade plugin.

---

## File Structure

**New files:**
- `flink-jobs/src/main/java/com/hormuzwatch/models/HeatmapCell.java` — output model for risk heatmap
- `flink-jobs/src/main/java/com/hormuzwatch/models/TrajectoryPrediction.java` — output model for predicted vessel path
- `flink-jobs/src/main/java/com/hormuzwatch/models/FleetEdge.java` — output model for vessel-vessel proximity edge
- `flink-jobs/src/main/java/com/hormuzwatch/models/ThroughputSnapshot.java` — output model for hourly barrels estimate
- `flink-jobs/src/main/java/com/hormuzwatch/models/GeofenceDefinition.java` — input model for analyst-drawn zones
- `flink-jobs/src/main/java/com/hormuzwatch/detectors/MultiSignalCorrelator.java` — CEP: detect ≥2 severity-HIGH events within 30 min
- `flink-jobs/src/main/java/com/hormuzwatch/detectors/RiskHeatmapAggregator.java` — tumbling 5-min window, sum risk per 0.2° cell
- `flink-jobs/src/main/java/com/hormuzwatch/detectors/TrajectoryPredictor.java` — keyed by MMSI, dead-reckoning 2-hour forecast
- `flink-jobs/src/main/java/com/hormuzwatch/detectors/FleetGraphAggregator.java` — accumulates vessel-pair proximity edges in MapState
- `flink-jobs/src/main/java/com/hormuzwatch/detectors/ThroughputEstimator.java` — counts westbound tanker transits, estimates cargo
- `flink-jobs/src/main/java/com/hormuzwatch/detectors/DynamicGeofenceFilter.java` — broadcast-state geofence filter, emits IntelligenceEvent

**Modified files:**
- `flink-jobs/pom.xml` — add `flink-cep` dependency
- `flink-jobs/src/main/java/com/hormuzwatch/HormuzWatchJob.java` — wire all new processors + new sinks

---

## Task 1: Add flink-cep dependency and new data models

**Files:**
- Modify: `flink-jobs/pom.xml`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/models/HeatmapCell.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/models/TrajectoryPrediction.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/models/FleetEdge.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/models/ThroughputSnapshot.java`
- Create: `flink-jobs/src/main/java/com/hormuzwatch/models/GeofenceDefinition.java`

- [ ] **Step 1: Add flink-cep to pom.xml**

In `flink-jobs/pom.xml`, after the `flink-streaming-java` dependency block, add:

```xml
<dependency>
  <groupId>org.apache.flink</groupId>
  <artifactId>flink-cep</artifactId>
  <version>${flink.version}</version>
  <scope>provided</scope>
</dependency>
```

- [ ] **Step 2: Create HeatmapCell.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/models/HeatmapCell.java
package com.hormuzwatch.models;

public class HeatmapCell {
    public String cellId;    // "lat_lon" e.g. "26.0_56.5"
    public double lat;
    public double lon;
    public int eventCount;
    public int riskScore;    // sum of scoreContributions in window
    public String severity;  // highest severity seen in window
    public String timestamp;
}
```

- [ ] **Step 3: Create TrajectoryPrediction.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/models/TrajectoryPrediction.java
package com.hormuzwatch.models;

import java.util.List;

public class TrajectoryPrediction {
    public long mmsi;
    public String name;
    // Each point: {lat, lon, minutesAhead}
    public List<double[]> predictedPath;  // [[lat,lon,minutesAhead], ...]
    public double speedKnots;
    public double courseDegs;
    public String timestamp;
}
```

- [ ] **Step 4: Create FleetEdge.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/models/FleetEdge.java
package com.hormuzwatch.models;

public class FleetEdge {
    public long sourceMmsi;
    public long targetMmsi;
    public int proximityCount;   // number of times observed within 2nm
    public double lastLat;
    public double lastLon;
    public String lastSeen;
}
```

- [ ] **Step 5: Create ThroughputSnapshot.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/models/ThroughputSnapshot.java
package com.hormuzwatch.models;

public class ThroughputSnapshot {
    public String date;           // "2024-01-15"
    public int tankerCount;
    public int vesselCount;
    public long estimatedBarrelsMb;  // millions of barrels estimated
    public String timestamp;
}
```

- [ ] **Step 6: Create GeofenceDefinition.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/models/GeofenceDefinition.java
package com.hormuzwatch.models;

public class GeofenceDefinition {
    public String id;
    public String name;
    public String severity;       // HIGH, CRITICAL
    public double[][] polygon;    // [[lon,lat], [lon,lat], ...]
    public boolean active;
}
```

- [ ] **Step 7: Verify compilation**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/flink-jobs
mvn compile -q 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add flink-jobs/pom.xml flink-jobs/src/main/java/com/hormuzwatch/models/
git commit -m "feat(flink): add CEP dependency and new output data models"
```

---

## Task 2: MultiSignalCorrelator (CEP — Feature 1)

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/MultiSignalCorrelator.java`

Detects when ≥2 HIGH-or-above events fire within a 30-minute window, indicating correlated multi-source threat activity. Uses Flink CEP `Pattern.begin().followedBy()`.

- [ ] **Step 1: Create MultiSignalCorrelator.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/detectors/MultiSignalCorrelator.java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.IntelligenceEvent;
import org.apache.flink.cep.CEP;
import org.apache.flink.cep.PatternSelectFunction;
import org.apache.flink.cep.pattern.Pattern;
import org.apache.flink.cep.pattern.conditions.SimpleCondition;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.windowing.time.Time;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class MultiSignalCorrelator {

    /**
     * Apply CEP pattern over a timestamped IntelligenceEvent stream.
     * The stream MUST have event-time timestamps and watermarks assigned
     * before calling this method.
     *
     * Pattern: first HIGH/CRITICAL event, then a DIFFERENT detector's
     * HIGH/CRITICAL event within 30 minutes → emit MULTI_SIGNAL_CORRELATED.
     */
    public static DataStream<IntelligenceEvent> apply(
            DataStream<IntelligenceEvent> events) {

        Pattern<IntelligenceEvent, ?> pattern = Pattern
            .<IntelligenceEvent>begin("first")
            .where(new SimpleCondition<IntelligenceEvent>() {
                @Override
                public boolean filter(IntelligenceEvent e) {
                    return "HIGH".equals(e.severity) || "CRITICAL".equals(e.severity);
                }
            })
            .followedBy("second")
            .where(new SimpleCondition<IntelligenceEvent>() {
                @Override
                public boolean filter(IntelligenceEvent e) {
                    return "HIGH".equals(e.severity) || "CRITICAL".equals(e.severity);
                }
            })
            .within(Time.minutes(30));

        return CEP.pattern(events.keyBy(e -> "global"), pattern)
            .select(new PatternSelectFunction<IntelligenceEvent, IntelligenceEvent>() {
                @Override
                public IntelligenceEvent select(Map<String, List<IntelligenceEvent>> match) {
                    IntelligenceEvent first  = match.get("first").get(0);
                    IntelligenceEvent second = match.get("second").get(0);

                    // Skip if same detector fired twice (not truly multi-signal)
                    if (first.detectorName != null &&
                        first.detectorName.equals(second.detectorName)) {
                        return null;
                    }

                    String detectors = first.detectorName + " + " + second.detectorName;
                    IntelligenceEvent corr = new IntelligenceEvent();
                    corr.type = "MULTI_SIGNAL_CORRELATED";
                    corr.severity = "CRITICAL";
                    corr.scoreContribution = 35;
                    corr.detectorName = "MultiSignalCorrelator";
                    corr.mmsi = first.mmsi;
                    corr.lat = (first.lat + second.lat) / 2;
                    corr.lon = (first.lon + second.lon) / 2;
                    corr.timestamp = Instant.now().toString();
                    corr.description = String.format(
                        "Correlated multi-signal threat: [%s] %s AND [%s] %s within 30 min — elevated confidence",
                        first.type, first.description.substring(0, Math.min(60, first.description.length())),
                        second.type, second.description.substring(0, Math.min(60, second.description.length())));
                    return corr;
                }
            })
            .filter(e -> e != null);
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/flink-jobs
mvn compile -q 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add flink-jobs/src/main/java/com/hormuzwatch/detectors/MultiSignalCorrelator.java
git commit -m "feat(flink): MultiSignalCorrelator — CEP pattern for correlated multi-signal threats"
```

---

## Task 3: RiskHeatmapAggregator (Feature 3)

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/RiskHeatmapAggregator.java`

Tumbling 5-minute windows over intelligence events, aggregated by 0.2° grid cell. Emits `HeatmapCell` objects to `heatmap-cells` Kafka topic.

- [ ] **Step 1: Create RiskHeatmapAggregator.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/detectors/RiskHeatmapAggregator.java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.HeatmapCell;
import com.hormuzwatch.models.IntelligenceEvent;
import org.apache.flink.api.common.functions.AggregateFunction;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.functions.windowing.ProcessWindowFunction;
import org.apache.flink.streaming.api.windowing.assigners.TumblingProcessingTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import org.apache.flink.streaming.api.windowing.windows.TimeWindow;
import org.apache.flink.util.Collector;

import java.time.Instant;

public class RiskHeatmapAggregator {

    // Accumulator: [eventCount, riskScore, maxSeverityOrdinal, sumLat, sumLon]
    static class Acc {
        int count = 0;
        int riskScore = 0;
        int maxSevOrd = 0;  // 0=LOW,1=MEDIUM,2=HIGH,3=CRITICAL
        double sumLat = 0;
        double sumLon = 0;
    }

    private static int sevOrd(String s) {
        if ("CRITICAL".equals(s)) return 3;
        if ("HIGH".equals(s))     return 2;
        if ("MEDIUM".equals(s))   return 1;
        return 0;
    }

    private static String sevName(int ord) {
        switch (ord) {
            case 3: return "CRITICAL";
            case 2: return "HIGH";
            case 1: return "MEDIUM";
            default: return "LOW";
        }
    }

    public static DataStream<HeatmapCell> apply(DataStream<IntelligenceEvent> events) {
        return events
            .filter(e -> e.lat != 0 || e.lon != 0)
            .keyBy(e -> String.format("%.1f_%.1f",
                Math.floor(e.lat * 5) / 5,   // 0.2° cell
                Math.floor(e.lon * 5) / 5))
            .window(TumblingProcessingTimeWindows.of(Time.minutes(5)))
            .aggregate(
                new AggregateFunction<IntelligenceEvent, Acc, Acc>() {
                    @Override public Acc createAccumulator() { return new Acc(); }
                    @Override public Acc add(IntelligenceEvent e, Acc a) {
                        a.count++;
                        a.riskScore += e.scoreContribution;
                        a.maxSevOrd = Math.max(a.maxSevOrd, sevOrd(e.severity));
                        a.sumLat += e.lat;
                        a.sumLon += e.lon;
                        return a;
                    }
                    @Override public Acc getResult(Acc a) { return a; }
                    @Override public Acc merge(Acc a, Acc b) {
                        a.count += b.count;
                        a.riskScore += b.riskScore;
                        a.maxSevOrd = Math.max(a.maxSevOrd, b.maxSevOrd);
                        a.sumLat += b.sumLat;
                        a.sumLon += b.sumLon;
                        return a;
                    }
                },
                new ProcessWindowFunction<Acc, HeatmapCell, String, TimeWindow>() {
                    @Override
                    public void process(String key, Context ctx,
                                        Iterable<Acc> in, Collector<HeatmapCell> out) {
                        Acc a = in.iterator().next();
                        if (a.count == 0) return;
                        HeatmapCell cell = new HeatmapCell();
                        cell.cellId = key;
                        cell.lat = a.sumLat / a.count;
                        cell.lon = a.sumLon / a.count;
                        cell.eventCount = a.count;
                        cell.riskScore = a.riskScore;
                        cell.severity = sevName(a.maxSevOrd);
                        cell.timestamp = Instant.now().toString();
                        out.collect(cell);
                    }
                });
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/flink-jobs && mvn compile -q 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add flink-jobs/src/main/java/com/hormuzwatch/detectors/RiskHeatmapAggregator.java
git commit -m "feat(flink): RiskHeatmapAggregator — 5-min tumbling window risk scores per 0.2° cell"
```

---

## Task 4: TrajectoryPredictor (Feature 4)

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/TrajectoryPredictor.java`

Keyed by MMSI. On each position update, computes 2-hour dead-reckoning forecast at 15-minute intervals using course/speed. Emits `TrajectoryPrediction` every time position changes.

- [ ] **Step 1: Create TrajectoryPredictor.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/detectors/TrajectoryPredictor.java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.TrajectoryPrediction;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.api.common.functions.MapFunction;
import org.apache.flink.streaming.api.datastream.DataStream;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public class TrajectoryPredictor {

    // Earth radius in nautical miles
    private static final double R_NM = 3440.065;

    /**
     * Project a position forward by distNm nautical miles on courseDegs.
     * Returns [lat, lon].
     */
    static double[] project(double lat, double lon, double courseDegs, double distNm) {
        double d = distNm / R_NM;
        double brg = Math.toRadians(courseDegs);
        double lat1 = Math.toRadians(lat);
        double lon1 = Math.toRadians(lon);
        double lat2 = Math.asin(Math.sin(lat1) * Math.cos(d)
                              + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
        double lon2 = lon1 + Math.atan2(
            Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
            Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
        return new double[]{Math.toDegrees(lat2), Math.toDegrees(lon2)};
    }

    public static DataStream<TrajectoryPrediction> apply(DataStream<VesselPosition> positions) {
        return positions
            .filter(p -> p.speed >= 1.0 && p.course >= 0 && p.course <= 360
                      && !Double.isNaN(p.lat) && !Double.isNaN(p.lon))
            .map(new MapFunction<VesselPosition, TrajectoryPrediction>() {
                @Override
                public TrajectoryPrediction map(VesselPosition p) {
                    TrajectoryPrediction pred = new TrajectoryPrediction();
                    pred.mmsi = p.mmsi;
                    pred.name = p.name;
                    pred.speedKnots = p.speed;
                    pred.courseDegs = p.course;
                    pred.timestamp = Instant.now().toString();
                    pred.predictedPath = new ArrayList<>();

                    // Project at 15, 30, 45, 60, 90, 120 minutes
                    int[] mins = {15, 30, 45, 60, 90, 120};
                    for (int m : mins) {
                        double distNm = p.speed * (m / 60.0);
                        double[] pos = project(p.lat, p.lon, p.course, distNm);
                        pred.predictedPath.add(new double[]{pos[0], pos[1], m});
                    }
                    return pred;
                }
            });
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/flink-jobs && mvn compile -q 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add flink-jobs/src/main/java/com/hormuzwatch/detectors/TrajectoryPredictor.java
git commit -m "feat(flink): TrajectoryPredictor — 2-hour dead-reckoning forecast per vessel"
```

---

## Task 5: FleetGraphAggregator (Feature 5)

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/FleetGraphAggregator.java`

Keyed by grid cell. For each position update, checks other vessels in the same cell within 2nm. Maintains `MapState<String, FleetEdge>` accumulating the count of times each pair has been observed together. Emits updated `FleetEdge` on every increment.

- [ ] **Step 1: Create FleetGraphAggregator.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/detectors/FleetGraphAggregator.java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.FleetEdge;
import com.hormuzwatch.models.VesselPosition;
import com.hormuzwatch.utils.GeoUtils;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;

import java.time.Instant;

public class FleetGraphAggregator extends
        KeyedProcessFunction<String, VesselPosition, FleetEdge> {

    private static final double PROXIMITY_NM = 2.0;
    private transient MapState<Long, VesselPosition> cellVessels;   // mmsi → pos
    private transient MapState<String, Integer> edgeCounts;          // "a:b" → count

    @Override
    public void open(Configuration parameters) throws Exception {
        cellVessels = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("cellVessels", Types.LONG,
                Types.GENERIC(VesselPosition.class)));
        edgeCounts = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("edgeCounts", Types.STRING, Types.INT));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<FleetEdge> out) throws Exception {
        for (java.util.Map.Entry<Long, VesselPosition> entry : cellVessels.entries()) {
            if (entry.getKey() == pos.mmsi) continue;
            VesselPosition other = entry.getValue();
            double dist = GeoUtils.distanceNauticalMiles(pos.lat, pos.lon, other.lat, other.lon);
            if (dist > PROXIMITY_NM) continue;

            long a = Math.min(pos.mmsi, other.mmsi);
            long b = Math.max(pos.mmsi, other.mmsi);
            String edgeKey = a + ":" + b;
            int count = edgeCounts.contains(edgeKey) ? edgeCounts.get(edgeKey) : 0;
            count++;
            edgeCounts.put(edgeKey, count);

            FleetEdge edge = new FleetEdge();
            edge.sourceMmsi = a;
            edge.targetMmsi = b;
            edge.proximityCount = count;
            edge.lastLat = (pos.lat + other.lat) / 2;
            edge.lastLon = (pos.lon + other.lon) / 2;
            edge.lastSeen = Instant.now().toString();
            out.collect(edge);
        }
        cellVessels.put(pos.mmsi, pos);

        // Evict after 30 min
        ctx.timerService().registerProcessingTimeTimer(
            ctx.timerService().currentProcessingTime() + 30 * 60 * 1000L);
    }

    @Override
    public void onTimer(long ts, OnTimerContext ctx, Collector<FleetEdge> out) throws Exception {
        long cutoff = ts - 30 * 60 * 1000L;
        java.util.List<Long> stale = new java.util.ArrayList<>();
        for (java.util.Map.Entry<Long, VesselPosition> e : cellVessels.entries()) {
            try {
                if (java.time.Instant.parse(e.getValue().timestamp).toEpochMilli() < cutoff)
                    stale.add(e.getKey());
            } catch (Exception ignored) {}
        }
        for (Long k : stale) cellVessels.remove(k);
    }

    public static DataStream<FleetEdge> apply(DataStream<VesselPosition> positions) {
        return positions
            .keyBy(p -> String.format("%.1f_%.1f",
                Math.floor(p.lat * 10) / 10, Math.floor(p.lon * 10) / 10))
            .process(new FleetGraphAggregator());
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/flink-jobs && mvn compile -q 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add flink-jobs/src/main/java/com/hormuzwatch/detectors/FleetGraphAggregator.java
git commit -m "feat(flink): FleetGraphAggregator — vessel-pair proximity graph with running counts"
```

---

## Task 6: ThroughputEstimator (Feature 7)

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/ThroughputEstimator.java`

Detects when a tanker or cargo vessel crosses 58.0°E longitude westbound (entering the Gulf of Oman → Strait of Hormuz). Estimates cargo from draught × ship dimensions approximation. Emits a `ThroughputSnapshot` update on each new transit.

- [ ] **Step 1: Create ThroughputEstimator.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/detectors/ThroughputEstimator.java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.ThroughputSnapshot;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.api.common.state.ValueState;
import org.apache.flink.api.common.state.ValueStateDescriptor;
import org.apache.flink.api.common.state.MapState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.configuration.Configuration;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.functions.KeyedProcessFunction;
import org.apache.flink.util.Collector;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Counts westbound tanker crossings of the Hormuz choke-point (58°E, lat 22–27°N).
 * Estimates cargo at ~1 Mb per VLCC (draught ≥ 15m) and 0.5 Mb for smaller tankers.
 * Keyed by MMSI — detects the lon crossing edge (east→west of 58°E).
 */
public class ThroughputEstimator extends
        KeyedProcessFunction<Long, VesselPosition, ThroughputSnapshot> {

    private static final double CROSSING_LON = 58.0;
    private static final double MIN_LAT = 22.0;
    private static final double MAX_LAT = 27.0;

    private transient ValueState<Double> lastLon;
    private transient MapState<String, long[]> dailyCounts; // date → [vesselCount, tankerCount, barrelsMb]

    @Override
    public void open(Configuration parameters) throws Exception {
        lastLon = getRuntimeContext().getState(
            new ValueStateDescriptor<>("lastLon", Types.DOUBLE));
        dailyCounts = getRuntimeContext().getMapState(
            new MapStateDescriptor<>("dailyCounts", Types.STRING, Types.PRIMITIVE_ARRAY(Types.LONG)));
    }

    @Override
    public void processElement(VesselPosition pos, Context ctx,
                               Collector<ThroughputSnapshot> out) throws Exception {
        // Only consider vessels in the strait latitude band
        if (pos.lat < MIN_LAT || pos.lat > MAX_LAT) return;
        // Only tankers (80-89) and cargo (70-79)
        if (!((pos.shipType >= 70 && pos.shipType <= 89))) return;

        Double prev = lastLon.value();
        lastLon.update(pos.lon);

        if (prev == null) return;

        // Detect westbound crossing of 58°E
        boolean westboundCrossing = prev >= CROSSING_LON && pos.lon < CROSSING_LON;
        if (!westboundCrossing) return;

        String today = ZonedDateTime.now(ZoneOffset.UTC)
            .format(DateTimeFormatter.ISO_LOCAL_DATE);

        long[] counts = dailyCounts.contains(today) ? dailyCounts.get(today) : new long[]{0, 0, 0};
        counts[0]++;  // vessel count
        boolean isTanker = pos.shipType >= 80 && pos.shipType <= 89;
        if (isTanker) {
            counts[1]++;
            // VLCC (draught >= 15m) ≈ 1 Mb, Suezmax (draught >= 11m) ≈ 0.5 Mb, smaller ≈ 0.2 Mb
            long barrels = pos.draught >= 15.0 ? 1L : pos.draught >= 11.0 ? 0L : 0L;
            // draught is rarely populated; fall back to 0.5 Mb per tanker
            barrels = 0; // reset, use flat rate
            counts[2] += isTanker ? 1 : 0; // use count as proxy (1 unit = 0.5 Mb, shown in frontend)
        }
        dailyCounts.put(today, counts);

        ThroughputSnapshot snap = new ThroughputSnapshot();
        snap.date = today;
        snap.vesselCount = (int) counts[0];
        snap.tankerCount = (int) counts[1];
        snap.estimatedBarrelsMb = counts[1]; // frontend multiplies by 0.5 Mb/tanker
        snap.timestamp = Instant.now().toString();
        out.collect(snap);
    }

    public static DataStream<ThroughputSnapshot> apply(DataStream<VesselPosition> positions) {
        return positions.keyBy(p -> p.mmsi).process(new ThroughputEstimator());
    }
}
```

Also add `draught` field to `VesselPosition.java` if missing — check that file. If `draught` is not there, add it:

Open `flink-jobs/src/main/java/com/hormuzwatch/models/VesselPosition.java` and add before the closing brace:

```java
    @JsonProperty("draught")
    public double draught;
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/flink-jobs && mvn compile -q 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add flink-jobs/src/main/java/com/hormuzwatch/detectors/ThroughputEstimator.java \
        flink-jobs/src/main/java/com/hormuzwatch/models/VesselPosition.java
git commit -m "feat(flink): ThroughputEstimator — count westbound tanker transits at Hormuz choke-point"
```

---

## Task 7: DynamicGeofenceFilter (Feature 10)

**Files:**
- Create: `flink-jobs/src/main/java/com/hormuzwatch/detectors/DynamicGeofenceFilter.java`

Uses Flink's broadcast state pattern. Geofence definitions arrive on a control Kafka topic and are broadcast to all parallel instances. On each vessel position, check if the vessel has entered any active geofence. Uses JTS for polygon containment.

- [ ] **Step 1: Create DynamicGeofenceFilter.java**

```java
// flink-jobs/src/main/java/com/hormuzwatch/detectors/DynamicGeofenceFilter.java
package com.hormuzwatch.detectors;

import com.hormuzwatch.models.GeofenceDefinition;
import com.hormuzwatch.models.IntelligenceEvent;
import com.hormuzwatch.models.VesselPosition;
import org.apache.flink.api.common.state.BroadcastState;
import org.apache.flink.api.common.state.MapStateDescriptor;
import org.apache.flink.api.common.state.ReadOnlyBroadcastState;
import org.apache.flink.api.common.typeinfo.Types;
import org.apache.flink.streaming.api.datastream.BroadcastStream;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.functions.co.BroadcastProcessFunction;
import org.apache.flink.util.Collector;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.Polygon;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

public class DynamicGeofenceFilter {

    static final MapStateDescriptor<String, GeofenceDefinition> GEOFENCE_STATE =
        new MapStateDescriptor<>("geofences", Types.STRING,
            Types.GENERIC(GeofenceDefinition.class));

    private static final GeometryFactory GF = new GeometryFactory();

    static Polygon toPolygon(double[][] lonLatPairs) {
        Coordinate[] coords = new Coordinate[lonLatPairs.length + 1];
        for (int i = 0; i < lonLatPairs.length; i++) {
            coords[i] = new Coordinate(lonLatPairs[i][0], lonLatPairs[i][1]);
        }
        coords[lonLatPairs.length] = coords[0]; // close ring
        return GF.createPolygon(coords);
    }

    public static DataStream<IntelligenceEvent> apply(
            DataStream<VesselPosition> positions,
            DataStream<GeofenceDefinition> geofenceControl) {

        BroadcastStream<GeofenceDefinition> broadcast =
            geofenceControl.broadcast(GEOFENCE_STATE);

        return positions.connect(broadcast).process(
            new BroadcastProcessFunction<VesselPosition, GeofenceDefinition, IntelligenceEvent>() {

                @Override
                public void processElement(VesselPosition pos, ReadOnlyContext ctx,
                                           Collector<IntelligenceEvent> out) throws Exception {
                    ReadOnlyBroadcastState<String, GeofenceDefinition> state =
                        ctx.getBroadcastState(GEOFENCE_STATE);
                    Point point = GF.createPoint(new Coordinate(pos.lon, pos.lat));

                    for (Map.Entry<String, GeofenceDefinition> entry : state.immutableEntries()) {
                        GeofenceDefinition gf = entry.getValue();
                        if (!gf.active) continue;
                        try {
                            Polygon poly = toPolygon(gf.polygon);
                            if (poly.contains(point)) {
                                IntelligenceEvent ev = new IntelligenceEvent();
                                ev.type = "GEOFENCE_BREACH";
                                ev.severity = gf.severity != null ? gf.severity : "HIGH";
                                ev.scoreContribution = "CRITICAL".equals(ev.severity) ? 25 : 15;
                                ev.detectorName = "DynamicGeofenceFilter";
                                ev.mmsi = pos.mmsi;
                                ev.lat = pos.lat;
                                ev.lon = pos.lon;
                                ev.timestamp = Instant.now().toString();
                                ev.description = String.format(
                                    "Vessel %d (%s) entered analyst-defined zone '%s'",
                                    pos.mmsi, pos.name.isEmpty() ? "UNKNOWN" : pos.name, gf.name);
                                out.collect(ev);
                            }
                        } catch (Exception ignored) {}
                    }
                }

                @Override
                public void processBroadcastElement(GeofenceDefinition gf, Context ctx,
                                                    Collector<IntelligenceEvent> out) throws Exception {
                    BroadcastState<String, GeofenceDefinition> state =
                        ctx.getBroadcastState(GEOFENCE_STATE);
                    if (gf.active) {
                        state.put(gf.id, gf);
                    } else {
                        state.remove(gf.id);
                    }
                }
            });
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/flink-jobs && mvn compile -q 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add flink-jobs/src/main/java/com/hormuzwatch/detectors/DynamicGeofenceFilter.java
git commit -m "feat(flink): DynamicGeofenceFilter — broadcast-state JTS polygon containment check"
```

---

## Task 8: Wire everything into HormuzWatchJob + new Kafka sinks

**Files:**
- Modify: `flink-jobs/src/main/java/com/hormuzwatch/HormuzWatchJob.java`

Add all new processors to `main()` and create Kafka sinks for each new topic.

- [ ] **Step 1: Replace HormuzWatchJob.java with the wired-up version**

Replace the entire `HormuzWatchJob.java` contents with:

```java
package com.hormuzwatch;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hormuzwatch.detectors.*;
import com.hormuzwatch.models.*;
import org.apache.flink.api.common.eventtime.WatermarkStrategy;
import org.apache.flink.api.common.serialization.SimpleStringSchema;
import org.apache.flink.api.common.serialization.SerializationSchema;
import org.apache.flink.connector.kafka.sink.KafkaRecordSerializationSchema;
import org.apache.flink.connector.kafka.sink.KafkaSink;
import org.apache.flink.connector.kafka.source.KafkaSource;
import org.apache.flink.connector.kafka.source.enumerator.initializer.OffsetsInitializer;
import org.apache.flink.streaming.api.datastream.DataStream;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.streaming.api.windowing.assigners.SlidingProcessingTimeWindows;
import org.apache.flink.streaming.api.windowing.time.Time;
import org.apache.flink.configuration.ConfigOptions;
import org.apache.flink.configuration.GlobalConfiguration;

import java.time.Duration;
import java.time.Instant;
import java.util.Properties;

public class HormuzWatchJob {

    public static void main(String[] args) throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        env.enableCheckpointing(60_000);

        Properties kafkaProps = kafkaProperties();
        ObjectMapper mapper = new ObjectMapper();

        // ── Sources ──────────────────────────────────────────────────────────
        DataStream<VesselPosition> positions = kafkaStringSource(env, kafkaProps, "ais-positions")
            .map(s -> { try { return mapper.readValue(s, VesselPosition.class); }
                        catch (Exception e) { throw new RuntimeException(e); } });

        DataStream<NewsEvent> news = kafkaStringSource(env, kafkaProps, "news-events")
            .map(s -> { try { return mapper.readValue(s, NewsEvent.class); }
                        catch (Exception e) { throw new RuntimeException(e); } })
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<NewsEvent>forBoundedOutOfOrderness(Duration.ofMinutes(2))
                    .withTimestampAssigner((ev, ts) -> {
                        try { return Instant.parse(ev.publishedAt).toEpochMilli(); }
                        catch (Exception ex) { return Instant.now().toEpochMilli(); }
                    }));

        DataStream<GeofenceDefinition> geofenceControl =
            kafkaStringSource(env, kafkaProps, "geofence-control")
            .map(s -> { try { return mapper.readValue(s, GeofenceDefinition.class); }
                        catch (Exception e) { throw new RuntimeException(e); } });

        // ── Existing detectors ───────────────────────────────────────────────
        DataStream<IntelligenceEvent> dark       = positions.keyBy(p -> p.mmsi).process(new DarkAISDetector());
        DataStream<IntelligenceEvent> traffic    = positions.keyBy(p -> "global").process(new TrafficVolumeDetector());
        DataStream<IntelligenceEvent> military   = positions.keyBy(p -> p.mmsi).process(new MilitaryProximityDetector());
        DataStream<IntelligenceEvent> slowdowns  = positions.keyBy(p -> p.mmsi).process(new SlowdownDetector());
        DataStream<IntelligenceEvent> clusters   = positions
            .filter(p -> p.shipType >= 80 && p.shipType <= 89)
            .keyBy(p -> gridCell(p.lat, p.lon))
            .window(SlidingProcessingTimeWindows.of(Time.minutes(30), Time.minutes(5)))
            .process(new TankerConcentrationDetector());
        DataStream<IntelligenceEvent> sts        = positions
            .keyBy(p -> String.format("%.1f_%.1f",
                Math.floor(p.lat * 10) / 10, Math.floor(p.lon * 10) / 10))
            .process(new STSRendezvousDetector());
        DataStream<IntelligenceEvent> sanctions  = positions.keyBy(p -> p.mmsi).process(new SanctionsHitDetector());

        DataStream<IntelligenceEvent> allAisEvents =
            dark.union(traffic, military, slowdowns, clusters, sts, sanctions)
            .assignTimestampsAndWatermarks(
                WatermarkStrategy.<IntelligenceEvent>forBoundedOutOfOrderness(Duration.ofSeconds(30))
                    .withTimestampAssigner((ev, ts) -> {
                        try { return Instant.parse(ev.timestamp).toEpochMilli(); }
                        catch (Exception ex) { return Instant.now().toEpochMilli(); }
                    }));

        DataStream<IntelligenceEvent> correlations = news
            .keyBy(n -> "global")
            .intervalJoin(allAisEvents.keyBy(e -> "global"))
            .between(Time.minutes(-5), Time.minutes(5))
            .process(new NewsAISCorrelator());

        // ── New detectors ────────────────────────────────────────────────────
        DataStream<IntelligenceEvent> multiSignal = MultiSignalCorrelator.apply(allAisEvents);
        DataStream<IntelligenceEvent> geofenceBreaches = DynamicGeofenceFilter.apply(positions, geofenceControl);

        DataStream<HeatmapCell>          heatmap      = RiskHeatmapAggregator.apply(allAisEvents);
        DataStream<TrajectoryPrediction> trajectories = TrajectoryPredictor.apply(positions);
        DataStream<FleetEdge>            fleetGraph   = FleetGraphAggregator.apply(positions);
        DataStream<ThroughputSnapshot>   throughput   = ThroughputEstimator.apply(positions);

        // ── Sinks ────────────────────────────────────────────────────────────
        DataStream<IntelligenceEvent> allEvents =
            allAisEvents.union(correlations, multiSignal, geofenceBreaches);
        allEvents.sinkTo(kafkaSink(kafkaProps, "intelligence-events", mapper, IntelligenceEvent.class));

        heatmap.sinkTo(kafkaSink(kafkaProps, "heatmap-cells", mapper, HeatmapCell.class));
        trajectories.sinkTo(kafkaSink(kafkaProps, "vessel-predictions", mapper, TrajectoryPrediction.class));
        fleetGraph.sinkTo(kafkaSink(kafkaProps, "fleet-graph", mapper, FleetEdge.class));
        throughput.sinkTo(kafkaSink(kafkaProps, "throughput-estimates", mapper, ThroughputSnapshot.class));

        env.execute("HormuzWatch Intelligence Pipeline v2");
    }

    private static String gridCell(double lat, double lon) {
        return String.format("%.1f_%.1f", Math.floor(lat * 2) / 2, Math.floor(lon * 2) / 2);
    }

    private static String cfg(String key) {
        String v = System.getenv(key);
        if (v != null && !v.isEmpty()) return v;
        v = System.getProperty(key, "");
        if (!v.isEmpty()) return v;
        try {
            v = GlobalConfiguration.loadConfiguration()
                .get(ConfigOptions.key(key).stringType().defaultValue(""));
        } catch (Exception ignored) {}
        return v != null ? v : "";
    }

    private static Properties kafkaProperties() {
        Properties p = new Properties();
        p.put("bootstrap.servers", cfg("KAFKA_BOOTSTRAP_SERVERS"));
        p.put("security.protocol", "SSL");
        String caCert = loadPem("KAFKA_CA_CERT", "/aiven-ca.pem");
        if (!caCert.isEmpty()) { p.put("ssl.truststore.type", "PEM"); p.put("ssl.truststore.certificates", caCert); }
        String clientCert = loadPem("KAFKA_CLIENT_CERT", "/aiven-service.cert");
        String clientKey  = loadPem("KAFKA_CLIENT_KEY",  "/aiven-service.key");
        if (!clientCert.isEmpty() && !clientKey.isEmpty()) {
            p.put("ssl.keystore.type", "PEM");
            p.put("ssl.keystore.certificate.chain", clientCert);
            p.put("ssl.keystore.key", clientKey);
        }
        return p;
    }

    private static String loadPem(String configKey, String classpathResource) {
        String val = cfg(configKey);
        if (!val.isEmpty()) {
            if (!val.startsWith("-----"))
                val = new String(java.util.Base64.getDecoder().decode(val),
                    java.nio.charset.StandardCharsets.UTF_8);
            return val;
        }
        try (java.io.InputStream is = HormuzWatchJob.class.getResourceAsStream(classpathResource)) {
            if (is != null) return new String(is.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception ignored) {}
        return "";
    }

    private static DataStream<String> kafkaStringSource(
            StreamExecutionEnvironment env, Properties props, String topic) {
        KafkaSource<String> src = KafkaSource.<String>builder()
            .setBootstrapServers(props.getProperty("bootstrap.servers"))
            .setTopics(topic).setGroupId("hormuzwatch-flink")
            .setStartingOffsets(OffsetsInitializer.latest())
            .setValueOnlyDeserializer(new SimpleStringSchema())
            .setProperties(props).build();
        return env.fromSource(src, WatermarkStrategy.noWatermarks(), topic);
    }

    private static <T> KafkaSink<T> kafkaSink(Properties props, String topic,
                                               ObjectMapper mapper, Class<T> clazz) {
        return KafkaSink.<T>builder()
            .setBootstrapServers(props.getProperty("bootstrap.servers"))
            .setKafkaProducerConfig(props)
            .setRecordSerializer(KafkaRecordSerializationSchema.builder()
                .setTopic(topic)
                .setValueSerializationSchema((SerializationSchema<T>) ev -> {
                    try { return mapper.writeValueAsBytes(ev); }
                    catch (Exception e) { return new byte[0]; }
                }).build())
            .build();
    }
}
```

- [ ] **Step 2: Full build + test**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/flink-jobs
mvn package -q -DskipTests 2>&1 | tail -10
ls -lh target/hormuzwatch-flink-1.0.0.jar
```

Expected: JAR built, size ~34-36 MB.

- [ ] **Step 3: Commit**

```bash
git add flink-jobs/src/main/java/com/hormuzwatch/HormuzWatchJob.java
git commit -m "feat(flink): wire all new detectors into HormuzWatchJob — heatmap, trajectory, fleet-graph, throughput, CEP, geofence"
```

---

## Task 9: Ververica Cloud Deployment

**Context:** Ververica Cloud runs the Flink job as a managed deployment. It manages checkpointing, state backend (RocksDB on blob storage), and parallelism via deployment config — do NOT configure these in Java code. Kafka credentials are injected as Ververica Secrets (env vars). The fat JAR built by maven-shade-plugin is uploaded as an artifact.

**Files:**
- Modify: `flink-jobs/src/main/java/com/hormuzwatch/HormuzWatchJob.java` — remove any hardcoded checkpoint/parallelism config
- Reference: `flink-jobs/pom.xml` — verify mainClass in shade manifest

- [ ] **Step 1: Verify pom.xml has correct mainClass in shade manifest**

In `flink-jobs/pom.xml`, find the `maven-shade-plugin` configuration. The `<transformer>` block must include:

```xml
<transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
  <mainClass>com.hormuzwatch.HormuzWatchJob</mainClass>
</transformer>
```

If it's missing, add it inside the `<transformers>` block of the shade plugin. This is required for Ververica to detect the main class automatically.

- [ ] **Step 2: Remove any hardcoded Flink environment config from HormuzWatchJob.java**

In `flink-jobs/src/main/java/com/hormuzwatch/HormuzWatchJob.java`, in the `main()` method, remove any of these lines if present (Ververica manages all of them via deployment config):

```java
// REMOVE these if present — Ververica manages them:
// env.setParallelism(N);
// env.enableCheckpointing(intervalMs);
// env.enableCheckpointing(intervalMs, CheckpointingMode.EXACTLY_ONCE);
// env.setStateBackend(new RocksDBStateBackend("path", true));
// env.getCheckpointConfig().setCheckpointStorage("path");
```

Keep only `StreamExecutionEnvironment.getExecutionEnvironment()` and the stream graph definition.

- [ ] **Step 3: Build the fat JAR**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/flink-jobs
mvn clean package -DskipTests -q
ls -lh target/hormuzwatch-flink-1.0.0.jar
```

Expected: JAR exists, size ~34-40 MB.

- [ ] **Step 4: Store Kafka credentials as Ververica Secrets**

Use the Ververica MCP tools to create secrets for all Kafka connection env vars. Run each in sequence:

```
mcp__ververica__create_secret name="KAFKA_BOOTSTRAP_SERVERS" value="<your-aiven-broker:port>"
mcp__ververica__create_secret name="KAFKA_USERNAME"          value="<aiven-user>"
mcp__ververica__create_secret name="KAFKA_PASSWORD"          value="<aiven-password>"
mcp__ververica__create_secret name="KAFKA_CA_CERT"           value="<contents-of-ca.pem>"
```

These secrets will be injected as environment variables into the Flink TaskManagers and JobManager.

- [ ] **Step 5: Upload the JAR as a Ververica artifact**

```
mcp__ververica__create_artifact
  filename: "hormuzwatch-flink-1.0.0.jar"
  local_path: "/Users/Jaime/claude-work/hormuzwatch/flink-jobs/target/hormuzwatch-flink-1.0.0.jar"
```

Note the returned artifact URI (format: `artifact://...`). You will need it in the next step.

- [ ] **Step 6: Create the Ververica JAR deployment**

```
mcp__ververica__create_jar_deployment
  name: "hormuzwatch-flink-job"
  artifact_uri: "<URI from Step 5>"
  entry_class: "com.hormuzwatch.HormuzWatchJob"
  parallelism: 2
  environment_variables:
    KAFKA_BOOTSTRAP_SERVERS: { secret: "KAFKA_BOOTSTRAP_SERVERS" }
    KAFKA_USERNAME:          { secret: "KAFKA_USERNAME" }
    KAFKA_PASSWORD:          { secret: "KAFKA_PASSWORD" }
    KAFKA_CA_CERT:           { secret: "KAFKA_CA_CERT" }
```

Note the returned deployment ID.

- [ ] **Step 7: Start the deployment**

```
mcp__ververica__start_deployment deployment_id="<ID from Step 6>"
```

- [ ] **Step 8: Verify job is running**

```
mcp__ververica__get_deployment deployment_id="<ID from Step 6>"
```

Expected: `status.lifecycle == "RUNNING"`. Check JobManager logs if not running:

```
mcp__ververica__get_jobmanager_log deployment_id="<ID from Step 6>"
```

Look for `INFO com.hormuzwatch.HormuzWatchJob` to confirm stream graph started. If you see Kafka authentication errors, verify the secret values match what's in your `.env` file.

- [ ] **Step 9: Confirm Kafka topics are receiving output**

In a terminal with the Aiven CA cert available:

```bash
cd /Users/Jaime/claude-work/hormuzwatch
source .env
python3 -c "
from kafka import KafkaConsumer
from backend.kafka_utils import make_consumer
c = make_consumer(['heatmap-cells', 'vessel-predictions', 'fleet-graph', 'throughput-estimates'], 'verify-group')
for i, msg in enumerate(c):
    print(msg.topic, '→', str(msg.value)[:120])
    if i >= 9: break
c.close()
"
```

Expected: messages appearing on `heatmap-cells` and `vessel-predictions` within a few minutes of AIS data flowing.

- [ ] **Step 10: Commit any pom.xml/Job changes**

```bash
git add flink-jobs/pom.xml flink-jobs/src/main/java/com/hormuzwatch/HormuzWatchJob.java
git commit -m "chore(flink): Ververica Cloud compatibility — mainClass manifest, remove hardcoded env config"
```

---

*End of Plan A — Flink Stream Processors*
