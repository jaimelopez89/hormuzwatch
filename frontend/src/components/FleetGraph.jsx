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
      const { nodes = [], edges = [] } = await res.json();
      if (!nodes?.length) return;

      setCounts({ nodes: nodes.length, edges: edges.length });

      const svg = d3.select(svgRef.current);
      simRef.current?.stop();
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
      const sim = d3.forceSimulation(ns)
        .force("link",   d3.forceLink(es).id(n => n.id).distance(55))
        .force("charge", d3.forceManyBody().strength(-70))
        .force("center", d3.forceCenter(W / 2, H / 2));
      simRef.current = sim;

      const g = svg.append("g");
      const link = g.append("g").selectAll("line").data(es).enter().append("line")
        .attr("stroke", "#334155")
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
