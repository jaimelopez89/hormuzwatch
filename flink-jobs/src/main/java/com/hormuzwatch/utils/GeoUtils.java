package com.hormuzwatch.utils;

import com.hormuzwatch.models.VesselPosition;
import org.locationtech.jts.geom.*;
import org.locationtech.jts.io.ParseException;
import org.locationtech.jts.io.geojson.GeoJsonReader;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * Geographic utility functions for AIS data processing.
 * Uses JTS (Java Topology Suite) for spatial operations.
 *
 * Adapted from AISguardian for HormuzWatch.
 */
public class GeoUtils implements Serializable {
    private static final long serialVersionUID = 1L;

    private static final GeometryFactory GEOMETRY_FACTORY = new GeometryFactory();
    private static final GeoJsonReader GEOJSON_READER = new GeoJsonReader();

    // Earth radius in nautical miles
    private static final double EARTH_RADIUS_NM = 3440.065;

    // Earth radius in meters
    private static final double EARTH_RADIUS_M = 6371000;

    /**
     * Create a JTS Point from latitude/longitude.
     */
    public static Point createPoint(double latitude, double longitude) {
        // Note: JTS uses (x, y) = (longitude, latitude)
        return GEOMETRY_FACTORY.createPoint(new Coordinate(longitude, latitude));
    }

    /**
     * Create a JTS Point from a VesselPosition.
     */
    public static Point createPoint(VesselPosition position) {
        return createPoint(position.lat, position.lon);
    }

    /**
     * Parse GeoJSON geometry into JTS Geometry.
     */
    public static Geometry parseGeoJson(Map<String, Object> geoJson) {
        try {
            String json = mapToJson(geoJson);
            return GEOJSON_READER.read(json);
        } catch (ParseException e) {
            throw new RuntimeException("Failed to parse GeoJSON: " + e.getMessage(), e);
        }
    }

    /**
     * Convert Map to JSON string (simple implementation).
     */
    private static String mapToJson(Map<String, Object> map) {
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        boolean first = true;
        for (Map.Entry<String, Object> entry : map.entrySet()) {
            if (!first) sb.append(",");
            first = false;
            sb.append("\"").append(entry.getKey()).append("\":");
            sb.append(valueToJson(entry.getValue()));
        }
        sb.append("}");
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static String valueToJson(Object value) {
        if (value == null) {
            return "null";
        } else if (value instanceof String) {
            return "\"" + value + "\"";
        } else if (value instanceof Number) {
            return value.toString();
        } else if (value instanceof Boolean) {
            return value.toString();
        } else if (value instanceof List) {
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (Object item : (List<?>) value) {
                if (!first) sb.append(",");
                first = false;
                sb.append(valueToJson(item));
            }
            sb.append("]");
            return sb.toString();
        } else if (value instanceof Map) {
            return mapToJson((Map<String, Object>) value);
        }
        return "\"" + value.toString() + "\"";
    }

    /**
     * Check if a vessel position is inside a polygon geometry.
     */
    public static boolean isPointInPolygon(VesselPosition position, Geometry polygon) {
        Point point = createPoint(position.lat, position.lon);
        return polygon.contains(point);
    }

    /**
     * Check if a point (lat/lon) is inside a polygon geometry.
     */
    public static boolean isPointInPolygon(double latitude, double longitude, Geometry polygon) {
        Point point = createPoint(latitude, longitude);
        return polygon.contains(point);
    }

    /**
     * Calculate distance between two points using Haversine formula.
     *
     * @return Distance in nautical miles
     */
    public static double distanceNauticalMiles(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);

        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);

        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return EARTH_RADIUS_NM * c;
    }

    /**
     * Calculate distance between two points.
     *
     * @return Distance in meters
     */
    public static double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);

        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);

        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return EARTH_RADIUS_M * c;
    }

    /**
     * Calculate distance between two vessel positions.
     *
     * @return Distance in meters
     */
    public static double distanceMeters(VesselPosition pos1, VesselPosition pos2) {
        return distanceMeters(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
    }

    /**
     * Calculate distance between two vessel positions.
     *
     * @return Distance in nautical miles
     */
    public static double distanceNauticalMiles(VesselPosition pos1, VesselPosition pos2) {
        return distanceNauticalMiles(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
    }

    /**
     * Calculate bearing from point 1 to point 2.
     *
     * @return Bearing in degrees (0-360)
     */
    public static double bearing(double lat1, double lon1, double lat2, double lon2) {
        double dLon = Math.toRadians(lon2 - lon1);
        double lat1Rad = Math.toRadians(lat1);
        double lat2Rad = Math.toRadians(lat2);

        double y = Math.sin(dLon) * Math.cos(lat2Rad);
        double x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

        double bearing = Math.toDegrees(Math.atan2(y, x));
        return (bearing + 360) % 360;
    }

    /**
     * Check if two vessels are close enough for a potential rendezvous.
     *
     * @param thresholdMeters Maximum distance in meters
     */
    public static boolean areVesselsClose(VesselPosition pos1, VesselPosition pos2, double thresholdMeters) {
        return distanceMeters(pos1, pos2) <= thresholdMeters;
    }

    /**
     * Check if a position is far from any port (open sea).
     *
     * @param latitude       Vessel latitude
     * @param longitude      Vessel longitude
     * @param portPositions  List of [lat, lon] for known ports
     * @param minDistanceNm  Minimum distance from ports in nautical miles
     */
    public static boolean isOpenSea(double latitude, double longitude,
                                     List<double[]> portPositions, double minDistanceNm) {
        for (double[] port : portPositions) {
            double distance = distanceNauticalMiles(latitude, longitude, port[0], port[1]);
            if (distance < minDistanceNm) {
                return false;
            }
        }
        return true;
    }

    /**
     * Create a bounding box around a point.
     *
     * @param latitude  Center latitude
     * @param longitude Center longitude
     * @param radiusNm  Radius in nautical miles
     * @return [minLat, minLon, maxLat, maxLon]
     */
    public static double[] createBoundingBox(double latitude, double longitude, double radiusNm) {
        // Approximate degrees per nautical mile
        double latDelta = radiusNm / 60.0;
        double lonDelta = radiusNm / (60.0 * Math.cos(Math.toRadians(latitude)));

        return new double[]{
                latitude - latDelta,
                longitude - lonDelta,
                latitude + latDelta,
                longitude + lonDelta
        };
    }

    /**
     * Check if a position is within a bounding box.
     */
    public static boolean isInBoundingBox(double latitude, double longitude, double[] bbox) {
        return latitude >= bbox[0] && latitude <= bbox[2] &&
                longitude >= bbox[1] && longitude <= bbox[3];
    }

    /**
     * Calculate the centroid of multiple vessel positions.
     *
     * @return [lat, lon] centroid, or null if positions is empty
     */
    public static double[] calculateCentroid(List<VesselPosition> positions) {
        if (positions.isEmpty()) {
            return null;
        }

        double sumLat = 0;
        double sumLon = 0;

        for (VesselPosition pos : positions) {
            sumLat += pos.lat;
            sumLon += pos.lon;
        }

        return new double[]{
                sumLat / positions.size(),
                sumLon / positions.size()
        };
    }

    /**
     * Calculate the area covered by a set of vessel positions (simple bounding box area).
     *
     * @return Area in square nautical miles
     */
    public static double calculateAreaCovered(List<VesselPosition> positions) {
        if (positions.size() < 2) {
            return 0;
        }

        double minLat = Double.MAX_VALUE, maxLat = Double.MIN_VALUE;
        double minLon = Double.MAX_VALUE, maxLon = Double.MIN_VALUE;

        for (VesselPosition pos : positions) {
            minLat = Math.min(minLat, pos.lat);
            maxLat = Math.max(maxLat, pos.lat);
            minLon = Math.min(minLon, pos.lon);
            maxLon = Math.max(maxLon, pos.lon);
        }

        double latDistance = distanceNauticalMiles(minLat, minLon, maxLat, minLon);
        double lonDistance = distanceNauticalMiles(minLat, minLon, minLat, maxLon);

        return latDistance * lonDistance;
    }
}
