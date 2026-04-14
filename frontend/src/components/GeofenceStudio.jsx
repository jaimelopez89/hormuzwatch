// frontend/src/components/GeofenceStudio.jsx
import { useEffect, useRef, useState } from "react";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function GeofenceStudio({ map }) {
  const drawRef = useRef(null);
  const geofencesRef = useRef([]);
  const [geofences, setGeofences] = useState([]);
  const [open, setOpen] = useState(false);

  // Load existing zones on mount
  useEffect(() => {
    fetch(`${API}/api/geofences`).then(r => r.ok ? r.json() : []).then(setGeofences).catch(() => {});
  }, []);

  // Keep geofencesRef in sync with state
  useEffect(() => {
    geofencesRef.current = geofences;
  }, [geofences]);

  useEffect(() => {
    if (!map) return;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      defaultMode: "simple_select",
      styles: [
        {
          id: "gl-draw-polygon-fill-active",
          type: "fill",
          filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
          paint: { "fill-color": "#ef4444", "fill-opacity": 0.15 },
        },
        {
          id: "gl-draw-polygon-stroke-active",
          type: "line",
          filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
          paint: { "line-color": "#ef4444", "line-width": 2 },
        },
      ],
    });
    drawRef.current = draw;
    map.addControl(draw, "top-right");

    function onCreate(e) {
      const feature = e.features[0];
      const gf = {
        id: uid(),
        drawId: feature.id,
        name: `Zone ${new Date().toLocaleTimeString()}`,
        geometry: feature.geometry,
        active: true,
        createdAt: new Date().toISOString(),
      };
      fetch(`${API}/api/geofences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gf),
      }).then(r => r.ok ? r.json() : null).then(res => {
        if (res) setGeofences(prev => [...prev, gf]);
      }).catch(() => {});
    }

    function onDelete(e) {
      for (const f of e.features) {
        const gf = geofencesRef.current.find(g => g.drawId === f.id);
        if (gf) fetch(`${API}/api/geofences/${gf.id}`, { method: "DELETE" }).catch(() => {});
        setGeofences(prev => prev.filter(g => g.drawId !== f.id));
      }
    }

    map.on("draw.create", onCreate);
    map.on("draw.delete", onDelete);

    return () => {
      // Map may already be destroyed (Map.jsx cleanup runs before ours)
      try {
        map.off("draw.create", onCreate);
        map.off("draw.delete", onDelete);
        if (map.hasControl(draw)) map.removeControl(draw);
      } catch {}
    };
  }, [map]);

  function deleteZone(gf) {
    if (drawRef.current && gf.drawId) {
      try { drawRef.current.delete(gf.drawId); } catch {}
    }
    fetch(`${API}/api/geofences/${gf.id}`, { method: "DELETE" }).catch(() => {});
    setGeofences(prev => prev.filter(g => g.id !== gf.id));
  }

  // Floating panel over map (bottom-right, above Mapbox controls)
  return (
    <div
      className="absolute z-10 font-mono"
      style={{ bottom: 120, right: 8, width: 220 }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-xs px-3 py-1.5 rounded flex items-center justify-between"
        style={{
          background: "#060d18ee",
          border: "1px solid #0f2a40",
          color: "#00d4ff",
          backdropFilter: "blur(4px)",
        }}
      >
        <span>GEOFENCE ZONES ({geofences.length})</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          className="mt-1 rounded p-2 flex flex-col gap-1"
          style={{
            background: "#060d18ee",
            border: "1px solid #0f2a40",
            backdropFilter: "blur(4px)",
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {geofences.length === 0 ? (
            <p className="text-xs italic" style={{ color: "#64748b" }}>
              Use polygon tool (top-right) to draw a zone.
            </p>
          ) : (
            geofences.map(gf => (
              <div key={gf.id} className="flex items-center gap-1.5">
                <span style={{ width: 6, height: 6, background: "#ef4444", borderRadius: "50%", flexShrink: 0, display: "inline-block" }} />
                <span className="flex-1 text-xs truncate" style={{ color: "#94a3b8", fontSize: 10 }}>{gf.name}</span>
                <button
                  onClick={() => deleteZone(gf)}
                  style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: 11 }}
                >✕</button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
