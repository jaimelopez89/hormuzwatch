// frontend/src/components/HeatmapLayer.jsx
import { useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const SRC = "heatmap-source";
const LYR = "heatmap-fill";

function toGeoJSON(cells) {
  return {
    type: "FeatureCollection",
    features: cells.map(c => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        // 0.2° grid cell centred on c.lat / c.lon
        coordinates: [[
          [c.lon - 0.1, c.lat - 0.1],
          [c.lon + 0.1, c.lat - 0.1],
          [c.lon + 0.1, c.lat + 0.1],
          [c.lon - 0.1, c.lat + 0.1],
          [c.lon - 0.1, c.lat - 0.1],
        ]],
      },
      properties: { riskScore: c.riskScore || 0 },
    })),
  };
}

export function HeatmapLayer({ map }) {
  const timerRef = useRef(null);

  async function refresh() {
    if (!map) return;
    const res = await fetch(`${API}/api/heatmap`).catch(() => null);
    if (!res?.ok) return;
    const cells = await res.json();
    map.getSource(SRC)?.setData(toGeoJSON(cells));
  }

  useEffect(() => {
    if (!map) return;

    function init() {
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: LYR,
          type: "fill",
          source: SRC,
          paint: {
            "fill-color": [
              "interpolate", ["linear"], ["get", "riskScore"],
              0,  "rgba(34,197,94,0)",
              10, "rgba(245,158,11,0.33)",
              30, "rgba(249,115,22,0.53)",
              60, "rgba(239,68,68,0.73)",
            ],
            "fill-opacity": 1,
          },
        }, "vessels"); // render below vessel icons
      }
      refresh();
      timerRef.current = setInterval(refresh, 30_000);
    }

    if (map.isStyleLoaded()) {
      init();
    } else {
      map.once("load", init);
    }

    return () => {
      clearInterval(timerRef.current);
      if (map.getLayer(LYR))  map.removeLayer(LYR);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map]);

  return null;
}
