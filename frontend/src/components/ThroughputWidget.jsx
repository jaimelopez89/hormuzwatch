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
              { label: "bbl/day",    value: `${(latest.barrelsPerDay / 1e6).toFixed(2)}M`, color: "#f97316" },
              { label: "tankers/hr", value: latest.tankerCount,                              color: "#00d4ff" },
              { label: "westbound",  value: latest.westboundTransits,                        color: "#22c55e" },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <div className="font-mono text-lg font-bold" style={{ color }}>{value}</div>
                <div className="font-mono text-xs" style={{ color: "#94a3b8" }}>{label}</div>
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
        <p className="text-xs italic" style={{ color: "#64748b" }}>
          No data yet — waiting for westbound tanker transits.
        </p>
      )}
    </div>
  );
}
