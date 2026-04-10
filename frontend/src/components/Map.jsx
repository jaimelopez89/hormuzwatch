import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const VESSEL_COLORS = {
  tanker:     "#f97316",
  military:   "#ef4444",
  cargo:      "#7c3aed",
  lng:        "#06b6d4",
  sanctioned: "#ef4444",
  other:      "#64748b",
};

const SANCTIONED_MMSIS = new Set([
  271000835, 271000836, 271000837,
  422023900, 422030700, 422060300, 422100600, 422112200, 422134400,
  422301600, 422310000, 422316000,
  657570200, 657570300, 657570400,
  511101390, 511101394, 538007800, 538008900, 577305000,
  352002785, 636091798,
]);

function vesselCategory(shipType, mmsi) {
  if (SANCTIONED_MMSIS.has(parseInt(mmsi, 10))) return "sanctioned";
  if (shipType >= 80 && shipType <= 89) return "tanker";
  if (shipType === 35 || shipType === 36) return "military";
  if (shipType >= 70 && shipType <= 79) return "cargo";
  if (shipType === 84 || shipType === 85) return "lng";
  return "other";
}

function drawVesselIcon(color, glow = false) {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
  }
  // Ship silhouette — pointed bow at top
  const cx = size / 2, h = size;
  ctx.beginPath();
  ctx.moveTo(cx, 2);          // bow
  ctx.lineTo(cx + 5, h - 4);  // starboard stern
  ctx.lineTo(cx, h - 7);      // stern notch
  ctx.lineTo(cx - 5, h - 4);  // port stern
  ctx.closePath();
  ctx.fill();
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
        paint: { "line-color": "#00d4ff", "line-width": 1.5, "line-opacity": 0.5, "line-dasharray": [6, 3] },
      });

      // Anchorage zone overlay
      map.addSource("anchorages", {
        type: "geojson",
        data: "/reference-data/geofences/anchorage_zones.geojson",
      });
      map.addLayer({
        id: "anchorages-fill",
        type: "fill",
        source: "anchorages",
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "anchorages-line",
        type: "line",
        source: "anchorages",
        paint: { "line-color": "#f59e0b", "line-width": 1, "line-opacity": 0.3, "line-dasharray": [3, 3] },
      });

      // Strait boundary overlay
      map.addSource("hormuz-strait", {
        type: "geojson",
        data: "/reference-data/geofences/hormuz_strait.geojson",
      });
      map.addLayer({
        id: "hormuz-strait-fill",
        type: "fill",
        source: "hormuz-strait",
        paint: { "fill-color": "#ef4444", "fill-opacity": 0.04 },
      });
      map.addLayer({
        id: "hormuz-strait-line",
        type: "line",
        source: "hormuz-strait",
        paint: { "line-color": "#ef4444", "line-width": 1, "line-opacity": 0.25, "line-dasharray": [2, 4] },
      });

      // Register vessel icons (sanctioned gets glow effect)
      Object.entries(VESSEL_COLORS).forEach(([cat, color]) => {
        const glow = cat === "sanctioned" || cat === "military";
        const img = drawVesselIcon(color, glow);
        const size = 24;
        map.addImage(`vessel-${cat}`, {
          data: img.getContext("2d").getImageData(0, 0, size, size).data,
          width: size, height: size,
        });
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

      // Hover tooltip
      const popup = new mapboxgl.Popup({
        closeButton: false, closeOnClick: false,
        className: "vessel-popup",
        offset: 14,
      });

      map.on("mouseenter", "vessels", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const props = e.features[0]?.properties;
        if (!props) return;
        const isSanctioned = props.category === "sanctioned";
        const html = `
          <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#e2e8f0;padding:4px 8px;min-width:140px">
            <div style="font-weight:700;margin-bottom:2px;color:${isSanctioned ? "#ef4444" : "#00d4ff"}">
              ${isSanctioned ? "⚠ SANCTIONED — " : ""}${props.name || "UNKNOWN"}
            </div>
            <div style="color:#94a3b8">MMSI ${props.mmsi}</div>
            <div style="color:#94a3b8">${(props.speed || 0).toFixed(1)} kt · ${props.flag || "—"}</div>
          </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on("mouseleave", "vessels", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("click", "vessels", (e) => {
        const props = e.features[0]?.properties;
        if (props && onVesselClick) onVesselClick(props);
      });
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
          category: vesselCategory(v.shipType || 0, v.mmsi),
          shipType: v.shipType, flag: v.flag,
          course: v.course, navStatus: v.navStatus,
          lat: v.lat, lon: v.lon,
        },
      })),
    });
  }, [vessels]);

  return <div ref={containerRef} className="w-full h-full" />;
}
