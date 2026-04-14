// frontend/src/components/TrajectoryLayer.jsx
import { useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const SRC = "trajectories-source";
const LYR = "trajectories-line";

function toGeoJSON(predictions) {
  return {
    type: "FeatureCollection",
    features: predictions
      .filter(p => p.predictedPath?.length >= 2)
      .map(p => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          // predictedPath: [[lat, lon, minutesAhead], ...]
          coordinates: p.predictedPath.map(pt => [pt[1], pt[0]]),
        },
        properties: { mmsi: p.mmsi, name: p.name || `MMSI ${p.mmsi}` },
      })),
  };
}

export function TrajectoryLayer({ map }) {
  const timerRef  = useRef(null);
  const activeRef = useRef(true);  // false once this component unmounts

  async function refresh() {
    if (!map || !activeRef.current) return;
    const res = await fetch(`${API}/api/predictions`).catch(() => null);
    if (!res?.ok || !activeRef.current) return;
    const preds = await res.json();
    try { map.getSource(SRC)?.setData(toGeoJSON(preds)); } catch {}
  }

  useEffect(() => {
    activeRef.current = true;
    if (!map) return;

    function init() {
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: LYR,
          type: "line",
          source: SRC,
          paint: {
            "line-color": "#a78bfa",
            "line-width": 1.5,
            "line-opacity": 0.7,
            "line-dasharray": [4, 3],
          },
        }, "vessels");
      }
      refresh();
      timerRef.current = setInterval(refresh, 60_000);
    }

    if (map.isStyleLoaded()) {
      init();
    } else {
      map.once("load", init);
    }

    return () => {
      activeRef.current = false;
      clearInterval(timerRef.current);
      // Map may already be destroyed (Map.jsx cleanup runs before ours)
      try {
        if (map.getLayer(LYR))  map.removeLayer(LYR);
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch {}
    };
  }, [map]);

  return null;
}
