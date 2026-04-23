// frontend/src/components/FleetGraph.jsx
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Same category palette as Map.jsx so the two views read consistently
const CATEGORY_COLORS = {
  tanker:     "#f97316",
  military:   "#ef4444",
  cargo:      "#7c3aed",
  lng:        "#06b6d4",
  sanctioned: "#ef4444",
  adversary:  "#fbbf24",
  other:      "#64748b",
};

const ADVERSARY_MIDS = new Set([422, 273, 468, 445]);
const ADVERSARY_FLAGS = new Set(["IR", "RU", "SY", "KP", "YE"]);
const SANCTIONED_MMSIS = new Set([
  271000835, 271000836, 271000837,
  422023900, 422030700, 422060300, 422100600, 422112200, 422134400,
  422301600, 422310000, 422316000,
  657570200, 657570300, 657570400,
  511101390, 511101394, 538007800, 538008900, 577305000,
  352002785, 636091798,
]);

function vesselCategory(shipType, mmsi, flag) {
  const m = parseInt(mmsi, 10);
  if (SANCTIONED_MMSIS.has(m)) return "sanctioned";
  const mid = Math.floor(m / 1_000_000);
  if (ADVERSARY_MIDS.has(mid)) return "adversary";
  if (flag && ADVERSARY_FLAGS.has(String(flag).toUpperCase().trim())) return "adversary";
  const t = Number(shipType) || 0;
  if (t >= 80 && t <= 89) return "tanker";
  if (t === 35 || t === 36) return "military";
  if (t >= 70 && t <= 79) return "cargo";
  if (t === 84 || t === 85) return "lng";
  return "other";
}

const LEGEND = [
  { label: "Tanker",     color: CATEGORY_COLORS.tanker },
  { label: "Cargo",      color: CATEGORY_COLORS.cargo },
  { label: "Military",   color: CATEGORY_COLORS.military },
  { label: "Adversary",  color: CATEGORY_COLORS.adversary },
  { label: "Sanctioned", color: CATEGORY_COLORS.sanctioned },
  { label: "Other",      color: CATEGORY_COLORS.other },
];

export function FleetGraph({ vessels = [] }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const [counts, setCounts] = useState({ nodes: 0, edges: 0, shown: 0 });
  const [loaded, setLoaded] = useState(false);
  const [graph, setGraph] = useState(null);

  // Build a lookup so we can enrich graph nodes with vessel names & types
  const vesselsByMmsi = {};
  for (const v of vessels) {
    vesselsByMmsi[String(v.mmsi)] = v;
  }

  useEffect(() => {
    let cancelled = false;

    async function fetchGraph() {
      const res = await fetch(`${API}/api/fleet-graph`).catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = await res.json();
      if (cancelled) return;
      setGraph(data);
    }

    fetchGraph();
    const t = setInterval(fetchGraph, 300_000);  // 5 min
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!graph) return;
    const { nodes = [], edges = [] } = graph;
    if (!nodes?.length) {
      setCounts({ nodes: 0, edges: 0, shown: 0 });
      setLoaded(true);
      return;
    }

    // Show only the top edges by proximity count — full graph is too dense
    const MAX_EDGES = 80;
    const sortedEdges = [...edges].sort((a, b) => (b.proximityCount || 1) - (a.proximityCount || 1));
    const topEdges = sortedEdges.slice(0, MAX_EDGES);

    const nodeIds = new Set();
    topEdges.forEach(e => { nodeIds.add(String(e.sourceMmsi)); nodeIds.add(String(e.targetMmsi)); });
    const topNodes = nodes.filter(n => nodeIds.has(String(n.id)));

    setCounts({ nodes: nodes.length, edges: edges.length, shown: topEdges.length });

    // Degree = number of partners each vessel has → node radius
    const degree = {};
    topEdges.forEach(e => {
      degree[String(e.sourceMmsi)] = (degree[String(e.sourceMmsi)] || 0) + 1;
      degree[String(e.targetMmsi)] = (degree[String(e.targetMmsi)] || 0) + 1;
    });

    const ns = topNodes.map(n => {
      const id = String(n.id);
      const v = vesselsByMmsi[id];
      const cat = v ? vesselCategory(v.shipType || v.ship_type, id, v.flag) : "other";
      return {
        id,
        name: v?.name || `MMSI ${id}`,
        category: cat,
        color: CATEGORY_COLORS[cat] || CATEGORY_COLORS.other,
        degree: degree[id] || 1,
      };
    });

    const es = topEdges.map(e => ({
      source: String(e.sourceMmsi),
      target: String(e.targetMmsi),
      count:  e.proximityCount || 1,
    }));

    const maxCount = Math.max(...es.map(e => e.count), 1);
    const maxDeg   = Math.max(...ns.map(n => n.degree), 1);

    const svg = d3.select(svgRef.current);
    simRef.current?.stop();
    svg.selectAll("*").remove();
    const el = svgRef.current;
    const W = el.clientWidth || 460;
    const H = 260;

    const sim = d3.forceSimulation(ns)
      .force("link", d3.forceLink(es).id(n => n.id).distance(d => 60 - Math.min(d.count / maxCount * 25, 25)))
      .force("charge", d3.forceManyBody().strength(-80))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide(d => 5 + (d.degree / maxDeg) * 6));
    simRef.current = sim;

    const g = svg.append("g");

    const link = g.append("g").selectAll("line").data(es).enter().append("line")
      .attr("stroke", d => {
        const r = d.count / maxCount;
        if (r > 0.7) return "#f97316";   // hot — repeat encounters
        if (r > 0.35) return "#3b6f9e";  // medium
        return "#1e3a5f";                // cold
      })
      .attr("stroke-width", d => Math.max(1, Math.min((d.count / maxCount) * 3.5, 4)))
      .attr("stroke-opacity", 0.7);

    link.append("title").text(d =>
      `${ns.find(n => n.id === d.source.id || n.id === d.source)?.name || d.source} ↔ ` +
      `${ns.find(n => n.id === d.target.id || n.id === d.target)?.name || d.target}\n` +
      `${d.count} proximity event${d.count === 1 ? "" : "s"}`
    );

    const node = g.append("g").selectAll("circle").data(ns).enter().append("circle")
      .attr("r", d => 3.5 + (d.degree / maxDeg) * 5)
      .attr("fill", d => d.color)
      .attr("stroke", "#030810")
      .attr("stroke-width", 1.2)
      .style("cursor", "grab")
      .call(d3.drag()
        .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag",  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on("end",   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    node.append("title").text(d =>
      `${d.name}\n${d.category} · ${d.degree} partner${d.degree === 1 ? "" : "s"}`
    );

    sim.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("cx", d => Math.max(8, Math.min(W - 8, d.x)))
          .attr("cy", d => Math.max(8, Math.min(H - 8, d.y)));
    });

    setLoaded(true);

    return () => { simRef.current?.stop(); };
  }, [graph, vessels]);

  return (
    <div className="panel flex flex-col" style={{ height: 360, overflow: "hidden" }}>
      <div className="panel-label">// Fleet Proximity Graph</div>

      <p className="text-xs mb-1" style={{ color: "#94a3b8", lineHeight: 1.4 }}>
        Vessels that repeatedly travel within 500 m of each other. Dots are ships,
        lines are encounter pairs — thicker/orange lines mean more repeated contacts,
        larger dots mean more partners. Helps spot convoys, ship‑to‑ship transfers
        and escort patterns.
      </p>

      <p className="text-[10px] italic mb-2" style={{ color: "#64748b" }}>
        {counts.nodes} vessels · {counts.edges} pairs
        {counts.shown < counts.edges && ` (top ${counts.shown} shown)`}
      </p>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <svg ref={svgRef} width="100%" height="260" style={{ display: "block" }} />
        {!loaded && (
          <p className="text-xs italic absolute top-2 left-2" style={{ color: "#64748b" }}>
            Loading proximity data…
          </p>
        )}
        {loaded && counts.edges === 0 && (
          <p className="text-xs italic absolute top-2 left-2" style={{ color: "#64748b" }}>
            No proximity pairs yet — Flink is still aggregating encounters.
          </p>
        )}

        {/* Mini-legend inside the chart */}
        <div
          className="absolute bottom-1 right-1 font-mono flex gap-2 flex-wrap"
          style={{
            background: "#060d18cc",
            border: "1px solid #0f2a40",
            borderRadius: 3,
            padding: "3px 6px",
            fontSize: 9,
            maxWidth: "70%",
          }}
        >
          {LEGEND.map(({ label, color }) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 6, height: 6, background: color, borderRadius: "50%", display: "inline-block" }} />
              <span style={{ color: "#94a3b8" }}>{label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
