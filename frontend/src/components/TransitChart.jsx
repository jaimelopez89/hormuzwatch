import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell, Legend,
} from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const INCIDENT_DATES = [
  { date: "2019-06-13", label: "Tanker attacks" },
  { date: "2019-09-14", label: "Abqaiq strike" },
  { date: "2021-07-29", label: "Mercer Street attack" },
  { date: "2023-11-17", label: "Galaxy Leader seizure" },
  { date: "2024-04-13", label: "Iran–Israel strikes" },
];

function getBarColor(pct, avg) {
  if (!avg) return "#00d4ff44";
  const ratio = pct / avg;
  if (ratio >= 0.9) return "#22c55e";
  if (ratio >= 0.6) return "#f59e0b";
  return "#ef4444";
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: "#040c18", border: "1px solid #0f2a40",
      borderRadius: 6, padding: "8px 12px", fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ color: "#00d4ff", fontSize: 11, marginBottom: 4 }}>{d.date}</div>
      <div style={{ color: "#e2e8f0", fontSize: 12 }}>Total: <strong>{d.n_total}</strong></div>
      {d.n_tanker > 0 && <div style={{ color: "#f97316", fontSize: 11 }}>Tankers: {d.n_tanker}</div>}
      {d.n_container > 0 && <div style={{ color: "#7c3aed", fontSize: 11 }}>Containers: {d.n_container}</div>}
      {d.pct_of_avg != null && (
        <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>
          {d.pct_of_avg}% of baseline
        </div>
      )}
    </div>
  );
};

export function TransitChart() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("90d"); // "90d" | "365d"

  useEffect(() => {
    fetch(`${API}/api/portwatch`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && !d.error && setData(d))
      .catch(() => {});

    const interval = setInterval(() => {
      fetch(`${API}/api/portwatch`)
        .then(r => r.ok ? r.json() : null)
        .then(d => d && !d.error && setData(d))
        .catch(() => {});
    }, 30 * 60 * 1000); // refresh every 30 min

    return () => clearInterval(interval);
  }, []);

  if (!data) {
    return (
      <div className="panel flex flex-col gap-2" style={{ minHeight: 200 }}>
        <div className="panel-label">// Strait of Hormuz — Daily Transit Count (IMF PortWatch)</div>
        <div className="flex items-center justify-center h-32">
          <p className="text-xs text-dimtext italic">Loading transit data from IMF PortWatch…</p>
        </div>
      </div>
    );
  }

  const days = view === "90d" ? (data.days || []) : (data.all_days || data.days || []);
  const avg90 = data.avg_90d || 0;

  // Enrich with pct_of_avg
  const chartData = days.map(d => ({
    ...d,
    pct_of_avg: avg90 > 0 ? Math.round(d.n_total / avg90 * 100) : null,
  }));

  // Find incident annotations within the visible window
  const visibleDates = new Set(chartData.map(d => d.date));
  const visibleIncidents = INCIDENT_DATES.filter(i => visibleDates.has(i.date));

  return (
    <div className="panel flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="panel-label mb-0">// Daily Transit Count — Strait of Hormuz (IMF PortWatch)</div>
        <div className="flex-1" />
        <div className="font-mono text-xs text-dimtext">
          Baseline: <span style={{ color: "#00d4ff" }}>{avg90} vessels/day</span>
        </div>
        {["90d", "365d"].map(v => (
          <button key={v} onClick={() => setView(v)}
            className="font-mono text-xs px-2 py-0.5 rounded border transition-colors"
            style={{
              borderColor: view === v ? "#00d4ff" : "#0f2a40",
              color: view === v ? "#00d4ff" : "#4a5568",
              background: view === v ? "#00d4ff11" : "transparent",
            }}>
            {v}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0f2a40" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "JetBrains Mono" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v?.slice(5) || ""} // MM-DD
            interval={view === "90d" ? 6 : 30}
          />
          <YAxis
            tick={{ fill: "#4a5568", fontSize: 9, fontFamily: "JetBrains Mono" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#00d4ff08" }} />

          {/* 90-day average reference line */}
          {avg90 > 0 && (
            <ReferenceLine
              y={avg90} stroke="#00d4ff" strokeDasharray="4 2" strokeWidth={1} opacity={0.4}
              label={{ value: "90d avg", fill: "#00d4ff", fontSize: 8, fontFamily: "JetBrains Mono", position: "right" }}
            />
          )}

          {/* 50% disruption threshold */}
          {avg90 > 0 && (
            <ReferenceLine
              y={avg90 * 0.5} stroke="#ef4444" strokeDasharray="2 4" strokeWidth={1} opacity={0.3}
              label={{ value: "50%", fill: "#ef4444", fontSize: 8, fontFamily: "JetBrains Mono", position: "right" }}
            />
          )}

          {/* Incident annotations */}
          {visibleIncidents.map(inc => (
            <ReferenceLine
              key={inc.date} x={inc.date}
              stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} opacity={0.5}
            />
          ))}

          <Bar dataKey="n_total" maxBarSize={8} radius={[2, 2, 0, 0]}>
            {chartData.map((entry, idx) => (
              <Cell key={idx} fill={getBarColor(entry.n_total, avg90)} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Bottom meta */}
      <div className="flex items-center justify-between text-xs font-mono text-dimtext">
        <span>
          Latest: <span style={{ color: "#e2e8f0" }}>{data.latest_date}</span>{" "}
          — <span style={{ color: data.pct_of_baseline >= 85 ? "#22c55e" : data.pct_of_baseline >= 50 ? "#f59e0b" : "#ef4444" }}>
            {data.latest_total} vessels ({data.pct_of_baseline}% of baseline)
          </span>
        </span>
        <span style={{ opacity: 0.5 }}>Source: IMF PortWatch · ~4 day lag</span>
      </div>
    </div>
  );
}
