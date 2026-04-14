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

const TRAIL_COLORS = {
  tanker:     "#f9731666",
  military:   "#ef444466",
  cargo:      "#7c3aed66",
  lng:        "#06b6d466",
  sanctioned: "#ef444466",
  other:      "#64748b44",
};

const MAX_TRAIL_POINTS = 12;

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
  const cx = size / 2, h = size;
  ctx.beginPath();
  ctx.moveTo(cx, 2);
  ctx.lineTo(cx + 5, h - 4);
  ctx.lineTo(cx, h - 7);
  ctx.lineTo(cx - 5, h - 4);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

// Build trail GeoJSON from history map
function buildTrailsGeoJSON(historyMap) {
  const features = [];
  for (const [mmsi, points] of Object.entries(historyMap)) {
    if (points.length < 2) continue;
    const cat = points[points.length - 1].category;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: points.map(p => [p.lon, p.lat]),
      },
      properties: { mmsi, category: cat, color: TRAIL_COLORS[cat] || TRAIL_COLORS.other },
    });
  }
  return { type: "FeatureCollection", features };
}

export function Map({ vessels, onVesselClick, onMapReady }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const trailHistoryRef = useRef({});  // mmsi → [{lat,lon,category}, ...]

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [56.3, 26.5],
      zoom: 7,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("tanker-lanes", { type: "geojson", data: "/reference-data/geofences/tanker_lanes.geojson" });
      map.addLayer({ id: "tanker-lanes", type: "line", source: "tanker-lanes",
        paint: { "line-color": "#00d4ff", "line-width": 1.5, "line-opacity": 0.5, "line-dasharray": [6, 3] } });

      map.addSource("anchorages", { type: "geojson", data: "/reference-data/geofences/anchorage_zones.geojson" });
      map.addLayer({ id: "anchorages-fill", type: "fill", source: "anchorages",
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0.08 } });
      map.addLayer({ id: "anchorages-line", type: "line", source: "anchorages",
        paint: { "line-color": "#f59e0b", "line-width": 1, "line-opacity": 0.3, "line-dasharray": [3, 3] } });

      map.addSource("hormuz-strait", { type: "geojson", data: "/reference-data/geofences/hormuz_strait.geojson" });
      map.addLayer({ id: "hormuz-strait-fill", type: "fill", source: "hormuz-strait",
        paint: { "fill-color": "#ef4444", "fill-opacity": 0.04 } });
      map.addLayer({ id: "hormuz-strait-line", type: "line", source: "hormuz-strait",
        paint: { "line-color": "#ef4444", "line-width": 1, "line-opacity": 0.25, "line-dasharray": [2, 4] } });

      // Vessel trail source + layer (below vessel icons)
      map.addSource("trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "trails",
        type: "line",
        source: "trails",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.5,
          "line-opacity": 0.6,
        },
      });

      // Vessel icons
      Object.entries(VESSEL_COLORS).forEach(([cat, color]) => {
        const glow = cat === "sanctioned" || cat === "military";
        const img = drawVesselIcon(color, glow);
        const size = 24;
        map.addImage(`vessel-${cat}`, {
          data: img.getContext("2d").getImageData(0, 0, size, size).data,
          width: size, height: size,
        });
      });

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

      // Fire onMapReady after all sources, layers, and images are initialized
      if (onMapReady) onMapReady(map);

      const popup = new mapboxgl.Popup({
        closeButton: false, closeOnClick: false,
        className: "vessel-popup", offset: 14,
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

    return () => {
      if (onMapReady) onMapReady(null);
      map.remove();
    };
  }, []);

  // Update vessels + trails when vessels prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const features = vessels.map((v) => {
      const category = vesselCategory(v.shipType || v.ship_type || 0, v.mmsi);

      // Update trail history
      const key = String(v.mmsi);
      if (!trailHistoryRef.current[key]) trailHistoryRef.current[key] = [];
      const trail = trailHistoryRef.current[key];
      const last = trail[trail.length - 1];
      if (!last || last.lat !== v.lat || last.lon !== v.lon) {
        trail.push({ lat: v.lat, lon: v.lon, category });
        if (trail.length > MAX_TRAIL_POINTS) trail.shift();
      }

      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lon, v.lat] },
        properties: {
          mmsi: v.mmsi, name: v.name, speed: v.speed,
          heading: v.heading === 511 ? 0 : (v.heading || 0),
          category,
          shipType: v.shipType || v.ship_type,
          flag: v.flag, course: v.course,
          navStatus: v.navStatus || v.nav_status,
          lat: v.lat, lon: v.lon,
        },
      };
    });

    map.getSource("vessels")?.setData({ type: "FeatureCollection", features });
    map.getSource("trails")?.setData(buildTrailsGeoJSON(trailHistoryRef.current));
  }, [vessels]);

  // Vessel type breakdown counts
  const tankers  = vessels.filter(v => { const t = v.shipType || v.ship_type || 0; return t >= 80 && t <= 89; }).length;
  const military = vessels.filter(v => { const t = v.shipType || v.ship_type || 0; return t === 35 || t === 36; }).length;
  const cargo    = vessels.filter(v => { const t = v.shipType || v.ship_type || 0; return t >= 70 && t <= 79; }).length;

  const LEGEND = [
    { label: "Tanker",     color: VESSEL_COLORS.tanker },
    { label: "Military",   color: VESSEL_COLORS.military },
    { label: "Cargo",      color: VESSEL_COLORS.cargo },
    { label: "LNG",        color: VESSEL_COLORS.lng },
    { label: "Sanctioned", color: VESSEL_COLORS.sanctioned, glow: true },
    { label: "Other",      color: VESSEL_COLORS.other },
  ];

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* Vessel breakdown overlay */}
      {vessels.length > 0 && (
        <div
          className="absolute top-3 left-3 z-10 flex gap-2 font-mono text-xs px-3 py-1.5 rounded"
          style={{ background: "#060d18cc", border: "1px solid #0f2a40", backdropFilter: "blur(4px)" }}
        >
          <span style={{ color: "#00d4ff" }}>{vessels.length} vessels</span>
          <span style={{ color: "#374151" }}>·</span>
          <span style={{ color: "#f97316" }}>{tankers} tankers</span>
          {military > 0 && <><span style={{ color: "#374151" }}>·</span><span style={{ color: "#ef4444" }}>{military} mil</span></>}
          {cargo > 0 && <><span style={{ color: "#374151" }}>·</span><span style={{ color: "#7c3aed" }}>{cargo} cargo</span></>}
        </div>
      )}

      {/* Vessel type legend */}
      <div
        className="absolute bottom-8 left-3 z-10 font-mono"
        style={{ background: "#060d18cc", border: "1px solid #0f2a40", backdropFilter: "blur(4px)", borderRadius: 4, padding: "6px 10px" }}
      >
        <div style={{ color: "#374151", fontSize: 8, letterSpacing: "0.12em", marginBottom: 4 }}>VESSEL TYPE</div>
        {LEGEND.map(({ label, color, glow }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{
              width: 7, height: 7,
              background: color,
              borderRadius: "50%",
              display: "inline-block",
              flexShrink: 0,
              boxShadow: glow ? `0 0 4px ${color}` : "none",
            }} />
            <span style={{ color: "#94a3b8", fontSize: 9 }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
