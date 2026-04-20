// frontend/src/components/FleetGraph.jsx
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function FleetGraph() {
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const [counts, setCounts] = useState({ nodes: 0, edges: 0, shown: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function draw() {
      const res = await fetch(`${API}/api/fleet-graph`).catch(() => null);
      if (!res?.ok || cancelled) return;
      const { nodes = [], edges = [] } = await res.json();
      if (!nodes?.length || cancelled) return;

      // Show only the top edges by proximity count — full graph is too dense
      const MAX_EDGES = 80;
      const sorted = [...edges].sort((a, b) => (b.proximityCount || 1) - (a.proximityCount || 1));
      const topEdges = sorted.slice(0, MAX_EDGES);

      // Only include nodes that appear in top edges
      const nodeIds = new Set();
      topEdges.forEach(e => { nodeIds.add(String(e.sourceMmsi)); nodeIds.add(String(e.targetMmsi)); });
      const topNodes = nodes.filter(n => nodeIds.has(String(n.id)));

      setCounts({ nodes: nodes.length, edges: edges.length, shown: topEdges.length });

      const svg = d3.select(svgRef.current);
      simRef.current?.stop();
      svg.selectAll("*").remove();
      const el = svgRef.current;
      const W = el.clientWidth || 460;
      const H = 250;

      const ns = topNodes.map(n => ({ ...n, id: String(n.id) }));
      const es = topEdges.map(e => ({
        source: String(e.sourceMmsi),
        target: String(e.targetMmsi),
        count:  e.proximityCount || 1,
      }));

      const maxCount = Math.max(...es.map(e => e.count), 1);

      const sim = d3.forceSimulation(ns)
        .force("link", d3.forceLink(es).id(n => n.id).distance(40))
        .force("charge", d3.forceManyBody().strength(-50))
        .force("center", d3.forceCenter(W / 2, H / 2))
        .force("collide", d3.forceCollide(8));
      simRef.current = sim;

      const g = svg.append("g");
      const link = g.append("g").selectAll("line").data(es).enter().append("line")
        .attr("stroke", d => d.count > maxCount * 0.7 ? "#f97316" : "#1e3a5f")
        .attr("stroke-width", d => Math.max(1, Math.min(d.count / maxCount * 3, 4)))
        .attr("stroke-opacity", 0.6);

      const node = g.append("g").selectAll("circle").data(ns).enter().append("circle")
        .attr("r", 4)
        .attr("fill", "#00d4ff")
        .attr("stroke", "#030810")
        .attr("stroke-width", 1)
        .call(d3.drag()
          .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on("drag",  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
          .on("end",   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

      node.append("title").text(d => `MMSI ${d.id}`);

      sim.on("tick", () => {
        link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("cx", d => Math.max(6, Math.min(W - 6, d.x)))
            .attr("cy", d => Math.max(6, Math.min(H - 6, d.y)));
      });

      setLoaded(true);
    }

    draw();
    // Refresh every 5 minutes, not 30 seconds
    const t = setInterval(draw, 300_000);
    return () => { cancelled = true; clearInterval(t); simRef.current?.stop(); };
  }, []);

  return (
    <div className="panel flex flex-col" style={{ height: 320, overflow: "hidden" }}>
      <div className="panel-label">// Fleet Proximity Graph</div>
      <p className="text-xs text-dimtext mb-2">
        {counts.nodes} vessels · {counts.edges} links
        {counts.shown < counts.edges && ` (top ${counts.shown} shown)`}
      </p>
      <svg ref={svgRef} width="100%" height="250" style={{ display: "block" }} />
      {!loaded && (
        <p className="text-xs italic" style={{ color: "#64748b" }}>Loading proximity data…</p>
      )}
    </div>
  );
}
