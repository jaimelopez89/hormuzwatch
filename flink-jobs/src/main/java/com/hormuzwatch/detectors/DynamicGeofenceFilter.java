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
        coords[lonLatPairs.length] = coords[0];
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
                                String vesselName = (pos.name != null && !pos.name.isEmpty()) ? pos.name : "UNKNOWN";
                                ev.description = String.format(
                                    "Vessel %d (%s) entered analyst-defined zone '%s'",
                                    pos.mmsi, vesselName, gf.name);
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
