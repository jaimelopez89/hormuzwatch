import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const VESSEL_COLORS = {
  tanker:   "#f97316",
  military: "#ef4444",
  cargo:    "#7c3aed",
  lng:      "#06b6d4",
  other:    "#64748b",
};

function vesselCategory(shipType) {
  if (shipType >= 80 && shipType <= 89) return "tanker";
  if (shipType === 35 || shipType === 36) return "military";
  if (shipType >= 70 && shipType <= 79) return "cargo";
  if (shipType === 84 || shipType === 85) return "lng";
  return "other";
}

function drawVesselIcon(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 20; canvas.height = 20;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(10, 2); ctx.lineTo(16, 16); ctx.lineTo(10, 13); ctx.lineTo(4, 16);
  ctx.closePath(); ctx.fill();
  return canvas;
}

export function Map({ vessels, onVesselClick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [56.3, 26.5],   // Strait of Hormuz
      zoom: 7,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Tanker lane overlay
      map.addSource("tanker-lanes", {
        type: "geojson",
        data: "/reference-data/geofences/tanker_lanes.geojson",
      });
      map.addLayer({
        id: "tanker-lanes",
        type: "line",
        source: "tanker-lanes",
        paint: { "line-color": "#00d4ff", "line-width": 1, "line-opacity": 0.4, "line-dasharray": [4, 2] },
      });

      // Register vessel icons
      Object.entries(VESSEL_COLORS).forEach(([cat, color]) => {
        const img = drawVesselIcon(color);
        map.addImage(`vessel-${cat}`, { data: img.getContext("2d").getImageData(0, 0, 20, 20).data, width: 20, height: 20 });
      });

      // Vessel GeoJSON source (updated dynamically)
      map.addSource("vessels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "vessels",
        type: "symbol",
        source: "vessels",
        layout: {
          "icon-image": ["concat", "vessel-", ["get", "category"]],
          "icon-size": 1,
          "icon-rotate": ["get", "heading"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
        },
      });

      map.on("click", "vessels", (e) => {
        const props = e.features[0]?.properties;
        if (props && onVesselClick) onVesselClick(props);
      });
      map.on("mouseenter", "vessels", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "vessels", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => map.remove();
  }, []);

  // Update vessel source when vessels prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("vessels");
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: vessels.map((v) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lon, v.lat] },
        properties: {
          mmsi: v.mmsi, name: v.name, speed: v.speed,
          heading: v.heading === 511 ? 0 : v.heading,
          category: vesselCategory(v.shipType || 0),
          shipType: v.shipType,
        },
      })),
    });
  }, [vessels]);

  return <div ref={containerRef} className="w-full h-full" />;
}
