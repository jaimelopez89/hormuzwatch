# Frontend Components — Next-Gen Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build nine new React components and wire them into App.jsx to visualise data from the new Flink processors and backend AI services: risk heatmap, trajectory overlays, fleet graph, NL query chat, throughput tracker, pipeline telemetry, AIS replay, streaming AI briefing, and analyst geofence studio.

**Architecture:** Map overlay components (HeatmapLayer, TrajectoryLayer, GeofenceStudio) receive the Mapbox GL map instance via an `onMapReady(map)` callback added to Map.jsx — they return null DOM and manage Mapbox layers through imperative API calls. Map.jsx also calls `onMapReady(null)` on cleanup so overlays know the map was destroyed. GeofenceStudio renders a floating panel over the map. Analytics panel components (FleetGraph, NLQueryPanel, ThroughputWidget, TelemetryPanel, ReplayControls, StreamingBriefing) live in a new fourth ANALYTICS tab.

**Tech Stack:** React 19, Mapbox GL JS 3, @mapbox/mapbox-gl-draw 1, D3 v7, recharts 3, native EventSource (SSE), Tailwind CSS.

---

## File Structure

**New files:**
- `frontend/src/components/HeatmapLayer.jsx` — logic-only; manages Mapbox fill layer from /api/heatmap
- `frontend/src/components/TrajectoryLayer.jsx` — logic-only; manages dashed line layer from /api/predictions
- `frontend/src/components/FleetGraph.jsx` — D3 force-directed SVG graph from /api/fleet-graph
- `frontend/src/components/NLQueryPanel.jsx` — SSE chat UI against /api/query
- `frontend/src/components/ThroughputWidget.jsx` — barrels/day from /api/throughput
- `frontend/src/components/TelemetryPanel.jsx` — pipeline metrics from /api/telemetry
- `frontend/src/components/ReplayControls.jsx` — date + speed slider, /api/replay/*
- `frontend/src/components/StreamingBriefing.jsx` — token-by-token SSE from /stream/briefing-tokens
- `frontend/src/components/GeofenceStudio.jsx` — Mapbox Draw + /api/geofences CRUD + floating list

**Modified files:**
- `frontend/package.json` — add d3@^7, @mapbox/mapbox-gl-draw@^1
- `frontend/src/components/Map.jsx` — add `onMapReady` prop, call with null on cleanup
- `frontend/src/App.jsx` — ANALYTICS tab, mapInstance state, map overlay wiring

---

## Task 1: Install new npm dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Add D3 and GL Draw to package.json**

In `frontend/package.json`, add after the `recharts` line inside `"dependencies"`:

```json
    "d3": "^7.9.0",
    "@mapbox/mapbox-gl-draw": "^1.4.3",
```

- [ ] **Step 2: Install**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/frontend && npm install
```

Expected: packages added, no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add d3 and mapbox-gl-draw dependencies"
```

---

## Task 2: Expose map instance from Map.jsx

**Files:**
- Modify: `frontend/src/components/Map.jsx`

- [ ] **Step 1: Change function signature**

Find line 84:
```jsx
export function Map({ vessels, onVesselClick }) {
```
Replace with:
```jsx
export function Map({ vessels, onVesselClick, onMapReady }) {
```

- [ ] **Step 2: Fire onMapReady after map loads**

In the `map.on("load", () => {` callback, after all `map.addLayer(...)` calls and just before the popup setup (before `const popup = new mapboxgl.Popup`), add:

```jsx
      if (onMapReady) onMapReady(map);
```

- [ ] **Step 3: Clear mapInstance on cleanup**

The cleanup currently reads `return () => map.remove();`. Change it to:

```jsx
    return () => {
      if (onMapReady) onMapReady(null);
      map.remove();
    };
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Map.jsx
git commit -m "feat(frontend): expose Mapbox instance via onMapReady callback"
```

---

## Task 3: HeatmapLayer

**Files:**
- Create: `frontend/src/components/HeatmapLayer.jsx`

- [ ] **Step 1: Create the file**

```jsx
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/HeatmapLayer.jsx
git commit -m "feat(frontend): HeatmapLayer — risk heatmap fill overlay"
```

---

## Task 4: TrajectoryLayer

**Files:**
- Create: `frontend/src/components/TrajectoryLayer.jsx`

- [ ] **Step 1: Create the file**

```jsx
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
  const timerRef = useRef(null);

  async function refresh() {
    if (!map) return;
    const res = await fetch(`${API}/api/predictions`).catch(() => null);
    if (!res?.ok) return;
    const preds = await res.json();
    map.getSource(SRC)?.setData(toGeoJSON(preds));
  }

  useEffect(() => {
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
      clearInterval(timerRef.current);
      if (map.getLayer(LYR))  map.removeLayer(LYR);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map]);

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/TrajectoryLayer.jsx
git commit -m "feat(frontend): TrajectoryLayer — dashed predicted-path overlay"
```

---

## Task 5: GeofenceStudio

**Files:**
- Create: `frontend/src/components/GeofenceStudio.jsx`

- [ ] **Step 1: Create the file**

```jsx
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
  const [geofences, setGeofences] = useState([]);
  const [open, setOpen] = useState(false);

  // Load existing zones on mount
  useEffect(() => {
    fetch(`${API}/api/geofences`).then(r => r.ok ? r.json() : []).then(setGeofences).catch(() => {});
  }, []);

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
        setGeofences(prev => {
          const gf = prev.find(g => g.drawId === f.id);
          if (gf) fetch(`${API}/api/geofences/${gf.id}`, { method: "DELETE" }).catch(() => {});
          return prev.filter(g => g.drawId !== f.id);
        });
      }
    }

    map.on("draw.create", onCreate);
    map.on("draw.delete", onDelete);

    return () => {
      map.off("draw.create", onCreate);
      map.off("draw.delete", onDelete);
      if (map.hasControl(draw)) map.removeControl(draw);
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
            <p className="text-xs italic" style={{ color: "#374151" }}>
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/GeofenceStudio.jsx
git commit -m "feat(frontend): GeofenceStudio — Mapbox Draw polygon tool with Flink CRUD"
```

---

## Task 6: FleetGraph

**Files:**
- Create: `frontend/src/components/FleetGraph.jsx`

- [ ] **Step 1: Create the file**

```jsx
// frontend/src/components/FleetGraph.jsx
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function FleetGraph() {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const [counts, setCounts] = useState({ nodes: 0, edges: 0 });

  useEffect(() => {
    async function draw() {
      const res = await fetch(`${API}/api/fleet-graph`).catch(() => null);
      if (!res?.ok) return;
      const { nodes, edges } = await res.json();
      if (!nodes?.length) return;

      setCounts({ nodes: nodes.length, edges: edges.length });

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      const el = svgRef.current;
      const W = el.clientWidth || 460;
      const H = el.clientHeight || 260;

      const ns = nodes.map(n => ({ ...n, id: String(n.id) }));
      const es = edges.map(e => ({
        source: String(e.sourceMmsi),
        target: String(e.targetMmsi),
        count:  e.proximityCount || 1,
      }));

      simRef.current?.stop();
      const sim = d3.forceSimulation(ns)
        .force("link",   d3.forceLink(es).id(n => n.id).distance(55))
        .force("charge", d3.forceManyBody().strength(-70))
        .force("center", d3.forceCenter(W / 2, H / 2));
      simRef.current = sim;

      const g = svg.append("g");
      const link = g.append("g").selectAll("line").data(es).enter().append("line")
        .attr("stroke", "#1e3a5f")
        .attr("stroke-width", d => Math.min(d.count, 4));

      const node = g.append("g").selectAll("circle").data(ns).enter().append("circle")
        .attr("r", 5)
        .attr("fill", "#00d4ff")
        .attr("stroke", "#030810")
        .attr("stroke-width", 1.5)
        .call(d3.drag()
          .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on("drag",  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
          .on("end",   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

      node.append("title").text(d => `MMSI ${d.id}`);

      sim.on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("cx", d => d.x).attr("cy", d => d.y);
      });
    }

    draw();
    const t = setInterval(draw, 30_000);
    return () => { clearInterval(t); simRef.current?.stop(); };
  }, []);

  return (
    <div className="panel flex flex-col" style={{ minHeight: 300 }}>
      <div className="panel-label">// Fleet Proximity Graph</div>
      <p className="text-xs text-dimtext mb-2">
        {counts.nodes} vessels · {counts.edges} proximity links
      </p>
      <svg ref={svgRef} className="flex-1 w-full" style={{ minHeight: 240 }} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/FleetGraph.jsx
git commit -m "feat(frontend): FleetGraph — D3 force-directed vessel proximity graph"
```

---

## Task 7: NLQueryPanel

**Files:**
- Create: `frontend/src/components/NLQueryPanel.jsx`

- [ ] **Step 1: Create the file**

```jsx
// frontend/src/components/NLQueryPanel.jsx
import { useState, useRef, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function NLQueryPanel() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const esRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  function submit(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    setStreaming(true);
    setHistory(h => [...h, { role: "user", text: q }, { role: "ai", text: "" }]);

    esRef.current?.close();
    const es = new EventSource(`${API}/api/query?question=${encodeURIComponent(q)}`);
    esRef.current = es;

    es.onmessage = ev => {
      setHistory(h => {
        const copy = [...h];
        copy[copy.length - 1] = { role: "ai", text: copy[copy.length - 1].text + ev.data };
        return copy;
      });
    };
    es.addEventListener("done", () => { setStreaming(false); es.close(); });
    es.onerror = () => { setStreaming(false); es.close(); };
  }

  return (
    <div className="panel flex flex-col" style={{ minHeight: 320 }}>
      <div className="panel-label">// Intelligence Query</div>
      <p className="text-xs text-dimtext mb-3">Ask about vessels, risk levels, or specific MMSIs.</p>

      <div className="flex-1 overflow-y-auto flex flex-col gap-2 mb-3" style={{ maxHeight: 240 }}>
        {history.length === 0 && (
          <p className="text-xs italic" style={{ color: "#374151" }}>No queries yet.</p>
        )}
        {history.map((msg, i) => (
          <div
            key={i}
            className={`text-xs rounded px-3 py-2 ${msg.role === "user" ? "self-end" : "self-start"}`}
            style={{
              background: msg.role === "user" ? "#0c2340" : "#060e1a",
              border: `1px solid ${msg.role === "user" ? "#1e3a5f" : "#0f2a40"}`,
              color: msg.role === "user" ? "#00d4ff" : "#94a3b8",
              maxWidth: "88%", whiteSpace: "pre-wrap",
            }}
          >
            {msg.text}
            {msg.role === "ai" && streaming && i === history.length - 1 && (
              <span className="inline-block w-1.5 h-3 ml-0.5 align-middle animate-pulse" style={{ background: "#00d4ff" }} />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="What vessels are near Fujairah?"
          disabled={streaming}
          className="flex-1 font-mono text-xs px-3 py-2 rounded"
          style={{ background: "#040b14", border: "1px solid #0f2a40", color: "#e2e8f0", outline: "none" }}
        />
        <button
          type="submit"
          disabled={streaming || !question.trim()}
          className="font-mono text-xs px-4 py-2 rounded"
          style={{
            background: streaming ? "#0f2a40" : "#00d4ff15",
            border: "1px solid #00d4ff33",
            color: streaming ? "#374151" : "#00d4ff",
            cursor: streaming ? "not-allowed" : "pointer",
          }}
        >
          {streaming ? "…" : "ASK"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/NLQueryPanel.jsx
git commit -m "feat(frontend): NLQueryPanel — streaming NL query interface"
```

---

## Task 8: ThroughputWidget, TelemetryPanel, ReplayControls, StreamingBriefing

**Files:**
- Create: `frontend/src/components/ThroughputWidget.jsx`
- Create: `frontend/src/components/TelemetryPanel.jsx`
- Create: `frontend/src/components/ReplayControls.jsx`
- Create: `frontend/src/components/StreamingBriefing.jsx`

- [ ] **Step 1: Create ThroughputWidget.jsx**

```jsx
// frontend/src/components/ThroughputWidget.jsx
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function ThroughputWidget() {
  const [data, setData] = useState([]);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`${API}/api/throughput`).catch(() => null);
      if (res?.ok) setData(await res.json());
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const latest = data[data.length - 1] || null;

  return (
    <div className="panel">
      <div className="panel-label">// Strait Throughput</div>
      {latest ? (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: "bbl/day",   value: `${(latest.barrelsPerDay / 1e6).toFixed(2)}M`, color: "#f97316" },
              { label: "tankers/hr", value: latest.tankerCount,                             color: "#00d4ff" },
              { label: "westbound",  value: latest.westboundTransits,                       color: "#22c55e" },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <div className="font-mono text-lg font-bold" style={{ color }}>{value}</div>
                <div className="font-mono text-xs" style={{ color: "#4a5568" }}>{label}</div>
              </div>
            ))}
          </div>
          {data.length > 1 && (
            <ResponsiveContainer width="100%" height={70}>
              <BarChart data={data.slice(-12)}>
                <XAxis dataKey="date" hide />
                <Tooltip
                  contentStyle={{ background: "#040b14", border: "1px solid #0f2a40", fontSize: 10 }}
                  formatter={v => [`${(v / 1e6).toFixed(2)}M bbl`, "throughput"]}
                />
                <Bar dataKey="barrelsPerDay" radius={[2, 2, 0, 0]}>
                  {data.slice(-12).map((_, i) => <Cell key={i} fill="#f97316" fillOpacity={0.55 + i * 0.035} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
      ) : (
        <p className="text-xs italic" style={{ color: "#374151" }}>
          No data yet — waiting for westbound tanker transits.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create TelemetryPanel.jsx**

```jsx
// frontend/src/components/TelemetryPanel.jsx
import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function Metric({ label, value, unit, color = "#00d4ff" }) {
  return (
    <div className="flex flex-col items-center px-2 py-2 rounded"
      style={{ background: "#040b14", border: "1px solid #0f2a40" }}>
      <div className="font-mono text-base font-bold" style={{ color }}>{value ?? "—"}</div>
      <div className="font-mono text-xs mt-0.5" style={{ color: "#4a5568" }}>{unit}</div>
      <div style={{ fontFamily: "monospace", fontSize: 9, color: "#374151", marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function TelemetryPanel() {
  const [t, setT] = useState(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`${API}/api/telemetry`).catch(() => null);
      if (res?.ok) setT(await res.json());
    };
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel">
      <div className="panel-label">// Pipeline Telemetry</div>
      <p className="text-xs text-dimtext mb-3">Flink → Kafka → Backend (live)</p>
      {t ? (
        <div className="grid grid-cols-3 gap-2">
          <Metric label="AIS MSG/S"  value={t.ais_messages_per_sec?.toFixed(1)} unit="msg/s" color="#00d4ff" />
          <Metric label="EVENTS/MIN" value={t.intel_events_per_min}              unit="ev/m"  color="#f97316" />
          <Metric label="SYNTH LAT"  value={t.avg_synthesis_latency_ms}          unit="ms"    color="#a78bfa" />
          <Metric label="VESSELS"    value={t.vessel_count}                       unit="live"  color="#22c55e" />
          <Metric label="TOPICS"     value={t.active_topics}                      unit="kafka" color="#f59e0b" />
          <Metric label="HEATMAP"    value={t.heatmap_cells}                      unit="cells" color="#06b6d4" />
        </div>
      ) : (
        <p className="text-xs italic" style={{ color: "#374151" }}>Loading…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create ReplayControls.jsx**

```jsx
// frontend/src/components/ReplayControls.jsx
import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const SPEEDS = [1, 5, 10, 20];

export function ReplayControls() {
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [speed, setSpeed] = useState(10);
  const [status, setStatus] = useState("idle");

  const statusColor = { idle: "#374151", running: "#22c55e", stopped: "#f59e0b" }[status];

  return (
    <div className="panel">
      <div className="panel-label">// AIS Replay</div>
      <p className="text-xs text-dimtext mb-3">Replay recorded vessel positions at compressed time.</p>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs" style={{ color: "#64748b", minWidth: 44 }}>DATE</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            disabled={status === "running"}
            className="font-mono text-xs px-2 py-1 rounded"
            style={{ background: "#040b14", border: "1px solid #0f2a40", color: "#e2e8f0", outline: "none" }}
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs" style={{ color: "#64748b", minWidth: 44 }}>SPEED</span>
          <div className="flex gap-1">
            {SPEEDS.map(s => (
              <button key={s} onClick={() => setSpeed(s)} disabled={status === "running"}
                className="font-mono text-xs px-2.5 py-1 rounded"
                style={{
                  background: speed === s ? "#00d4ff22" : "#040b14",
                  border: `1px solid ${speed === s ? "#00d4ff55" : "#0f2a40"}`,
                  color: speed === s ? "#00d4ff" : "#64748b",
                  cursor: status === "running" ? "not-allowed" : "pointer",
                }}
              >{s}×</button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-xs" style={{ color: "#64748b", minWidth: 44 }}>STATUS</span>
          <span className="font-mono text-xs font-bold" style={{ color: statusColor }}>{status.toUpperCase()}</span>
        </div>

        <div className="flex gap-2 mt-1">
          <button
            onClick={async () => {
              const r = await fetch(`${API}/api/replay/start`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date, speed_multiplier: speed }),
              }).catch(() => null);
              if (r?.ok) setStatus("running");
            }}
            disabled={status === "running"}
            className="font-mono text-xs px-4 py-1.5 rounded"
            style={{ background: "#22c55e18", border: "1px solid #22c55e44", color: status === "running" ? "#374151" : "#22c55e", cursor: status === "running" ? "not-allowed" : "pointer" }}
          >PLAY</button>
          <button
            onClick={async () => {
              await fetch(`${API}/api/replay/stop`, { method: "POST" }).catch(() => null);
              setStatus("stopped");
            }}
            disabled={status !== "running"}
            className="font-mono text-xs px-4 py-1.5 rounded"
            style={{ background: "#f59e0b18", border: "1px solid #f59e0b44", color: status !== "running" ? "#374151" : "#f59e0b", cursor: status !== "running" ? "not-allowed" : "pointer" }}
          >STOP</button>
          <button
            onClick={async () => {
              await fetch(`${API}/api/replay/reset`, { method: "POST" }).catch(() => null);
              setStatus("idle");
            }}
            className="font-mono text-xs px-4 py-1.5 rounded"
            style={{ background: "#040b14", border: "1px solid #0f2a40", color: "#64748b", cursor: "pointer" }}
          >RESET</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create StreamingBriefing.jsx**

```jsx
// frontend/src/components/StreamingBriefing.jsx
import { useEffect, useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function StreamingBriefing() {
  const [text, setText] = useState("");
  const [latencyMs, setLatencyMs] = useState(null);
  const [live, setLive] = useState(false);
  const esRef = useRef(null);

  useEffect(() => {
    function connect() {
      esRef.current?.close();
      const es = new EventSource(`${API}/stream/briefing-tokens`);
      esRef.current = es;

      es.addEventListener("start", () => { setText(""); setLive(true); });

      es.onmessage = ev => setText(prev => prev + ev.data);

      es.addEventListener("done", ev => {
        setLive(false);
        try {
          const meta = JSON.parse(ev.data);
          if (meta.synthesis_duration_ms) setLatencyMs(meta.synthesis_duration_ms);
        } catch {}
      });

      es.onerror = () => { setLive(false); setTimeout(connect, 5_000); };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  return (
    <div className="panel flex flex-col" style={{ minHeight: 160 }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="panel-label">// AI Briefing — Live Stream</div>
        {live && <span className="font-mono text-xs animate-pulse" style={{ color: "#a78bfa" }}>GENERATING</span>}
      </div>
      <div className="flex-1 font-mono text-xs leading-relaxed" style={{ color: "#94a3b8", whiteSpace: "pre-wrap" }}>
        {text || <span className="italic" style={{ color: "#374151" }}>Waiting for next synthesis cycle…</span>}
        {live && <span className="inline-block w-1.5 h-3 ml-0.5 align-middle animate-pulse" style={{ background: "#a78bfa" }} />}
      </div>
      {latencyMs !== null && (
        <div className="mt-2 font-mono text-xs" style={{ color: "#374151" }}>
          generation: {latencyMs.toLocaleString()}ms
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit all four**

```bash
git add frontend/src/components/ThroughputWidget.jsx frontend/src/components/TelemetryPanel.jsx \
         frontend/src/components/ReplayControls.jsx frontend/src/components/StreamingBriefing.jsx
git commit -m "feat(frontend): ThroughputWidget, TelemetryPanel, ReplayControls, StreamingBriefing"
```

---

## Task 9: Wire everything into App.jsx

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Replace App.jsx**

```jsx
import { useState } from "react";
import { Header } from "./components/Header";
import { HeroStatus } from "./components/HeroStatus";
import { Map } from "./components/Map";
import { Sidebar } from "./components/Sidebar";
import { IntelFeed } from "./components/IntelFeed";
import { VesselDetail } from "./components/VesselDetail";
import { ToastAlerts } from "./components/ToastAlerts";
import { TransitChart } from "./components/TransitChart";
import { PolymarketWidget } from "./components/PolymarketWidget";
import { HealthDashboard } from "./components/HealthDashboard";
import { IncidentTimeline } from "./components/IncidentTimeline";
import { HeatmapLayer } from "./components/HeatmapLayer";
import { TrajectoryLayer } from "./components/TrajectoryLayer";
import { GeofenceStudio } from "./components/GeofenceStudio";
import { FleetGraph } from "./components/FleetGraph";
import { NLQueryPanel } from "./components/NLQueryPanel";
import { ThroughputWidget } from "./components/ThroughputWidget";
import { TelemetryPanel } from "./components/TelemetryPanel";
import { ReplayControls } from "./components/ReplayControls";
import { StreamingBriefing } from "./components/StreamingBriefing";
import { useVesselStream } from "./hooks/useVesselStream";
import { useBriefingStream } from "./hooks/useBriefingStream";
import { useMarketStream } from "./hooks/useMarketStream";
import { useBrowserAlerts } from "./hooks/useBrowserAlerts";

const TABS = [
  { id: "map",       label: "LIVE MAP"   },
  { id: "intel",     label: "INTEL FEED" },
  { id: "data",      label: "DATA & CHARTS" },
  { id: "analytics", label: "ANALYTICS"  },
];

export default function App() {
  const vessels  = useVesselStream();
  const briefing = useBriefingStream();
  const market   = useMarketStream();
  const [selectedVessel, setSelectedVessel] = useState(null);
  const [tab, setTab] = useState("map");
  const [mapInstance, setMapInstance] = useState(null);

  useBrowserAlerts(true);

  return (
    <div className="flex flex-col" style={{ height: "100dvh", background: "#030810", overflow: "hidden" }}>
      <Header />
      <ToastAlerts />
      <HeroStatus />

      <div className="flex shrink-0 border-b" style={{ borderColor: "#0f2a40" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex-1 font-mono text-xs py-2 tracking-widest transition-colors"
            style={{
              color: tab === t.id ? "#00d4ff" : "#4a5568",
              borderBottom: tab === t.id ? "2px solid #00d4ff" : "2px solid transparent",
              background: tab === t.id ? "#00d4ff06" : "transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">

        {/* MAP TAB */}
        {tab === "map" && (
          <div className="flex h-full">
            <div className="flex-1 relative min-w-0">
              <Map vessels={vessels} onVesselClick={setSelectedVessel} onMapReady={setMapInstance} />
              <VesselDetail vessel={selectedVessel} onClose={() => setSelectedVessel(null)} />
              {mapInstance && <HeatmapLayer map={mapInstance} />}
              {mapInstance && <TrajectoryLayer map={mapInstance} />}
              {mapInstance && <GeofenceStudio map={mapInstance} />}
            </div>
            <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: 580, borderLeft: "1px solid #0f2a40", background: "#040b14" }}>
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                <Sidebar briefing={briefing} market={market} />
              </div>
              <div style={{ height: 200, borderTop: "1px solid #0f2a40", flexShrink: 0 }}>
                <IntelFeed compact />
              </div>
            </div>
          </div>
        )}

        {/* INTEL TAB */}
        {tab === "intel" && (
          <div className="h-full p-3">
            <IntelFeed fullHeight />
          </div>
        )}

        {/* DATA TAB */}
        {tab === "data" && (
          <div className="h-full overflow-y-auto p-3 flex flex-col gap-3">
            <TransitChart />
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <PolymarketWidget />
              <HealthDashboard />
            </div>
            <IncidentTimeline />
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Sidebar briefing={briefing} market={market} inline />
            </div>
          </div>
        )}

        {/* ANALYTICS TAB */}
        {tab === "analytics" && (
          <div className="h-full overflow-y-auto p-3 flex flex-col gap-3">
            <NLQueryPanel />
            <StreamingBriefing />
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <FleetGraph />
              <ThroughputWidget />
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <TelemetryPanel />
              <ReplayControls />
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

```bash
cd /Users/Jaime/claude-work/hormuzwatch/frontend && npm run build
```

Expected: build succeeds with no errors. Warnings about bundle size are acceptable.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): ANALYTICS tab — wire all next-gen AI/Flink components"
```

---

## Self-Review

**Spec coverage:**
- Feature 1 (Multi-signal CEP): no frontend component needed — events appear in IncidentTimeline ✓
- Feature 2 (Pipeline telemetry): TelemetryPanel ✓
- Feature 3 (Risk heatmap): HeatmapLayer ✓
- Feature 4 (Trajectory prediction): TrajectoryLayer ✓
- Feature 5 (Fleet graph): FleetGraph ✓
- Feature 6 (NL query): NLQueryPanel ✓
- Feature 7 (Throughput estimator): ThroughputWidget ✓
- Feature 8 (AIS replay): ReplayControls ✓
- Feature 9 (Streaming briefing): StreamingBriefing ✓
- Feature 10 (Geofence studio): GeofenceStudio ✓

**Placeholder scan:** No TBDs or vague steps. All steps contain real code.

**Type consistency:** All API endpoints match Plan B signatures. `predictedPath` is `[[lat,lon,minutesAhead]]`, `fleet-graph` returns `{nodes,edges}`, throughput returns array of snapshots. Consistent throughout.
