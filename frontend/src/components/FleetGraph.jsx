// frontend/src/components/FleetGraph.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Same palette as Map.jsx so the two views read consistently
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
  const vesselsRef = useRef({});
  const [counts, setCounts] = useState({ nodes: 0, edges: 0, shown: 0 });
  const [loaded, setLoaded] = useState(false);
  const [graph, setGraph] = useState(null);
  const [selected, setSelected] = useState(null);   // { kind: "node"|"edge", data }
  const [showHelp, setShowHelp] = useState(false);

  // Always keep vesselsRef fresh so the d3 effect can look up names without
  // depending on `vessels` (which updates every SSE tick and would otherwise
  // nuke the force simulation several times a second).
  useMemo(() => {
    const m = {};
    for (const v of vessels) m[String(v.mmsi)] = v;
    vesselsRef.current = m;
  }, [vessels]);

  // Fetch graph every 5 minutes (not on every vessel SSE tick)
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
    const t = setInterval(fetchGraph, 300_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Build / rebuild the d3 chart ONLY when the graph payload changes.
  // Vessel stream updates go through the ref and refresh names on next fetch.
  useEffect(() => {
    if (!graph) return;
    const { nodes = [], edges = [] } = graph;

    if (!nodes?.length) {
      setCounts({ nodes: 0, edges: 0, shown: 0 });
      setLoaded(true);
      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      return;
    }

    const MAX_EDGES = 120;
    const sortedEdges = [...edges].sort((a, b) => (b.proximityCount || 1) - (a.proximityCount || 1));
    const topEdges = sortedEdges.slice(0, MAX_EDGES);

    const nodeIds = new Set();
    topEdges.forEach(e => { nodeIds.add(String(e.sourceMmsi)); nodeIds.add(String(e.targetMmsi)); });
    const topNodes = nodes.filter(n => nodeIds.has(String(n.id)));

    setCounts({ nodes: nodes.length, edges: edges.length, shown: topEdges.length });

    const degree = {};
    topEdges.forEach(e => {
      degree[String(e.sourceMmsi)] = (degree[String(e.sourceMmsi)] || 0) + 1;
      degree[String(e.targetMmsi)] = (degree[String(e.targetMmsi)] || 0) + 1;
    });

    const byId = vesselsRef.current;
    const ns = topNodes.map(n => {
      const id = String(n.id);
      const v = byId[id];
      const cat = v ? vesselCategory(v.shipType || v.ship_type, id, v.flag) : "other";
      return {
        id,
        mmsi: id,
        name: v?.name || `MMSI ${id}`,
        flag: v?.flag || "—",
        shipType: v?.shipType || v?.ship_type,
        speed: v?.speed,
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
    const W = el.clientWidth || 700;
    const H = el.clientHeight || 420;

    // Zoom + pan container
    const root = svg.append("g");
    svg.call(
      d3.zoom()
        .scaleExtent([0.4, 4])
        .on("zoom", (ev) => root.attr("transform", ev.transform))
    );

    const sim = d3.forceSimulation(ns)
      .force("link", d3.forceLink(es).id(n => n.id).distance(d => 70 - Math.min(d.count / maxCount * 30, 30)))
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide(d => 8 + (d.degree / maxDeg) * 8));
    simRef.current = sim;

    const link = root.append("g").selectAll("line").data(es).enter().append("line")
      .attr("stroke", d => {
        const r = d.count / maxCount;
        if (r > 0.7) return "#f97316";
        if (r > 0.35) return "#3b6f9e";
        return "#1e3a5f";
      })
      .attr("stroke-width", d => Math.max(1, Math.min((d.count / maxCount) * 4, 5)))
      .attr("stroke-opacity", 0.7)
      .style("cursor", "pointer")
      .on("click", (ev, d) => {
        ev.stopPropagation();
        const srcName = typeof d.source === "object" ? d.source.name : d.source;
        const tgtName = typeof d.target === "object" ? d.target.name : d.target;
        const srcId   = typeof d.source === "object" ? d.source.id : d.source;
        const tgtId   = typeof d.target === "object" ? d.target.id : d.target;
        setSelected({
          kind: "edge",
          data: { srcName, tgtName, srcId, tgtId, count: d.count },
        });
      });

    const node = root.append("g").selectAll("circle").data(ns).enter().append("circle")
      .attr("r", d => 5 + (d.degree / maxDeg) * 7)
      .attr("fill", d => d.color)
      .attr("stroke", "#030810")
      .attr("stroke-width", 1.4)
      .style("cursor", "grab")
      .on("click", (ev, d) => {
        ev.stopPropagation();
        const partners = es
          .filter(e => {
            const s = typeof e.source === "object" ? e.source.id : e.source;
            const t = typeof e.target === "object" ? e.target.id : e.target;
            return s === d.id || t === d.id;
          })
          .map(e => {
            const s = typeof e.source === "object" ? e.source.id : e.source;
            const t = typeof e.target === "object" ? e.target.id : e.target;
            const other = s === d.id ? t : s;
            const otherNode = ns.find(x => x.id === other);
            return { id: other, name: otherNode?.name || other, count: e.count, category: otherNode?.category };
          })
          .sort((a, b) => b.count - a.count);

        setSelected({ kind: "node", data: { ...d, partners } });
      })
      .call(d3.drag()
        .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag",  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on("end",   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

    // Label the busiest nodes (top 20% by degree) so users can orient
    const topByDegree = [...ns].sort((a, b) => b.degree - a.degree).slice(0, Math.max(6, Math.floor(ns.length * 0.2)));
    const topIds = new Set(topByDegree.map(n => n.id));
    const label = root.append("g").selectAll("text").data(ns.filter(n => topIds.has(n.id))).enter().append("text")
      .text(d => d.name)
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-size", 9)
      .attr("fill", "#94a3b8")
      .attr("pointer-events", "none")
      .attr("dx", 10)
      .attr("dy", 3);

    svg.on("click", () => setSelected(null));

    sim.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("cx", d => Math.max(10, Math.min(W - 10, d.x)))
          .attr("cy", d => Math.max(10, Math.min(H - 10, d.y)));
      label.attr("x", d => d.x).attr("y", d => d.y);
    });

    setLoaded(true);
    setSelected(null);

    return () => { simRef.current?.stop(); };
  }, [graph]);

  return (
    <div className="panel flex flex-col" style={{ minHeight: 520, overflow: "hidden" }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="panel-label mb-0 flex-1">// Fleet Proximity Graph</div>
        <button
          onClick={() => setShowHelp(s => !s)}
          className="font-mono text-xs px-2 py-0.5 rounded border"
          style={{
            borderColor: showHelp ? "#00d4ff" : "#0f2a40",
            color: showHelp ? "#00d4ff" : "#94a3b8",
            background: showHelp ? "#00d4ff11" : "transparent",
          }}
        >
          {showHelp ? "HIDE HELP" : "HELP"}
        </button>
        <span className="font-mono text-xs" style={{ color: "#64748b" }}>
          {counts.nodes} vessels · {counts.edges} pairs
          {counts.shown < counts.edges && ` (top ${counts.shown} shown)`}
        </span>
      </div>

      {showHelp && (
        <div
          className="font-mono text-xs mb-2 p-2 rounded"
          style={{ background: "#0a1a2e", border: "1px solid #0f2a40", color: "#94a3b8", lineHeight: 1.5 }}
        >
          <strong style={{ color: "#00d4ff" }}>What this shows:</strong> every pair of vessels
          that a Flink job has observed repeatedly travelling within <strong>500 m</strong> of each
          other. Useful for spotting <em>convoys</em>, <em>ship‑to‑ship transfers</em> and
          <em> escort patterns</em> that don't show up as single‑vessel alerts.
          <br /><br />
          <strong style={{ color: "#00d4ff" }}>Dots = vessels.</strong> Coloured by category
          (see legend). Bigger dot = more partners. <strong>Lines = encounter pairs.</strong>
          Thicker / orange line = more repeated contacts (cold blue ↔ hot orange).
          <br /><br />
          <strong style={{ color: "#00d4ff" }}>Interact:</strong> drag dots to rearrange ·
          scroll to zoom · drag empty space to pan · click a dot to see the vessel's partners ·
          click a line to see the two vessels and their encounter count.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 420 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 0, background: "#040b14", border: "1px solid #0f2a40", borderRadius: 3 }}>
          <svg ref={svgRef} width="100%" height="100%" style={{ display: "block", minHeight: 420 }} />
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

          <div
            className="absolute bottom-2 right-2 font-mono flex gap-2 flex-wrap"
            style={{
              background: "#060d18cc",
              border: "1px solid #0f2a40",
              borderRadius: 3,
              padding: "4px 8px",
              fontSize: 10,
              maxWidth: "70%",
            }}
          >
            {LEGEND.map(({ label, color }) => (
              <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 7, height: 7, background: color, borderRadius: "50%", display: "inline-block" }} />
                <span style={{ color: "#94a3b8" }}>{label}</span>
              </span>
            ))}
          </div>
        </div>

        <div
          style={{
            width: 280,
            flexShrink: 0,
            background: "#040b14",
            border: "1px solid #0f2a40",
            borderRadius: 3,
            padding: 10,
            overflowY: "auto",
            maxHeight: 500,
          }}
          className="font-mono text-xs"
        >
          {!selected && (
            <div style={{ color: "#64748b", fontStyle: "italic", lineHeight: 1.5 }}>
              Click a dot to inspect a vessel and its proximity partners.
              <br /><br />
              Click a line to see the two vessels in that encounter pair and how often they've been observed together.
            </div>
          )}

          {selected?.kind === "node" && (
            <div>
              <div style={{ color: selected.data.color, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                {selected.data.name}
              </div>
              <div style={{ color: "#94a3b8", marginBottom: 2 }}>MMSI {selected.data.mmsi}</div>
              <div style={{ color: "#94a3b8", marginBottom: 2 }}>
                {selected.data.category.toUpperCase()} · flag {selected.data.flag || "—"}
              </div>
              {selected.data.speed != null && (
                <div style={{ color: "#94a3b8", marginBottom: 8 }}>
                  {Number(selected.data.speed).toFixed(1)} kt
                </div>
              )}
              <div style={{ color: "#00d4ff", marginTop: 10, marginBottom: 4, letterSpacing: "0.08em" }}>
                PARTNERS ({selected.data.partners.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {selected.data.partners.map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      width: 6, height: 6,
                      background: CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other,
                      borderRadius: "50%", flexShrink: 0,
                    }} />
                    <span style={{ color: "#e2e8f0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </span>
                    <span style={{ color: "#64748b" }}>×{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selected?.kind === "edge" && (
            <div>
              <div style={{ color: "#00d4ff", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                Encounter pair
              </div>
              <div style={{ color: "#e2e8f0", marginBottom: 4 }}>{selected.data.srcName}</div>
              <div style={{ color: "#64748b", marginBottom: 4 }}>↕</div>
              <div style={{ color: "#e2e8f0", marginBottom: 10 }}>{selected.data.tgtName}</div>
              <div style={{ color: "#94a3b8" }}>
                <strong style={{ color: "#f97316" }}>{selected.data.count}</strong> proximity
                event{selected.data.count === 1 ? "" : "s"} observed (within 500 m)
              </div>
              <div style={{ color: "#64748b", marginTop: 8, fontStyle: "italic", lineHeight: 1.4 }}>
                High counts often indicate convoys, planned rendezvous, or ship‑to‑ship transfer operations.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
