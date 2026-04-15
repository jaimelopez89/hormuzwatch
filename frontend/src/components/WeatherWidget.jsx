// WeatherWidget — maritime weather at the Strait of Hormuz centroid
// Source: ECMWF IFS via Open-Meteo (no API key required)
import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const BEAUFORT_COLOR = [
  "#22c55e","#22c55e","#22c55e","#22c55e","#22c55e","#22c55e",   // 0-5 green
  "#f59e0b","#f59e0b",                                            // 6-7 amber
  "#f97316","#f97316",                                            // 8-9 orange
  "#ef4444","#ef4444","#ef4444",                                  // 10-12 red
];

function WindArrow({ deg }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 14,
        transform: `rotate(${deg}deg)`,
        lineHeight: 1,
      }}
    >
      ↑
    </span>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontFamily: "monospace", fontSize: 8, letterSpacing: "0.15em", color: "#94a3b8" }}>
        {label}
      </div>
      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: color || "#e2e8f0", lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: "monospace", fontSize: 9, color: "#64748b" }}>{sub}</div>
      )}
    </div>
  );
}

export function WeatherWidget() {
  const [wx, setWx]     = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchWx() {
      try {
        const res = await fetch(`${API}/api/weather`);
        if (!res.ok) { setError(true); return; }
        const data = await res.json();
        if (data.error) { setError(true); return; }
        setWx(data);
        setError(false);
      } catch { setError(true); }
    }
    fetchWx();
    const t = setInterval(fetchWx, 15 * 60_000);  // refresh every 15 min
    return () => clearInterval(t);
  }, []);

  if (error) {
    return (
      <div className="panel">
        <div className="panel-label">// Maritime Weather</div>
        <p className="text-xs text-dimtext">Weather data unavailable.</p>
      </div>
    );
  }

  if (!wx) {
    return (
      <div className="panel">
        <div className="panel-label">// Maritime Weather</div>
        <p className="text-xs text-dimtext">Loading…</p>
      </div>
    );
  }

  const bftColor = BEAUFORT_COLOR[wx.beaufort] || "#94a3b8";
  const waveColor = wx.wave_m >= 3.0 ? "#ef4444" : wx.wave_m >= 2.0 ? "#f97316" : wx.wave_m >= 1.0 ? "#f59e0b" : "#22c55e";
  const riskMod = wx.risk_modifier || 0;

  // Forecast chart — hourly wind for next 24 h
  const chartData = (wx.forecast || []).slice(0, 24).map(f => ({
    t: f.time?.slice(11, 16) || "",
    wind: f.wind_kt,
    gusts: f.gusts_kt,
    waves: f.wave_m,
  }));

  return (
    <div className="panel flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="panel-label mb-0">// Maritime Weather · Strait of Hormuz</div>
        <div style={{ fontFamily: "monospace", fontSize: 8, color: "#475569" }}>
          ECMWF · {wx.updated_utc?.slice(0, 16) || ""} UTC
        </div>
      </div>

      {/* Current conditions */}
      <div className="flex gap-4 flex-wrap">
        <Stat
          label="WIND"
          value={<><WindArrow deg={wx.wind_dir} /> {wx.wind_kt} kt</>}
          color={bftColor}
          sub={`${wx.wind_dir_label} · gusts ${wx.gusts_kt} kt`}
        />
        <Stat
          label="SEA STATE"
          value={`${wx.wave_m} m`}
          color={waveColor}
          sub={`swell from ${wx.wave_dir_label}`}
        />
        <Stat
          label="BEAUFORT"
          value={`${wx.beaufort}`}
          color={bftColor}
          sub={wx.beaufort_label}
        />
        {riskMod > 0 && (
          <Stat
            label="WEATHER RISK"
            value={`+${riskMod}`}
            color={riskMod >= 15 ? "#ef4444" : riskMod >= 8 ? "#f97316" : "#f59e0b"}
            sub="risk score modifier"
          />
        )}
      </div>

      {/* 24-h forecast chart */}
      {chartData.length > 0 && (
        <div>
          <div style={{ fontFamily: "monospace", fontSize: 8, letterSpacing: "0.12em", color: "#475569", marginBottom: 4 }}>
            24-HOUR FORECAST (wind kt / wave m)
          </div>
          <div style={{ height: 60 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="t" tick={{ fontSize: 7, fill: "#64748b", fontFamily: "monospace" }}
                  tickLine={false} axisLine={false} interval={5} />
                <Tooltip
                  contentStyle={{ background: "#060d18", border: "1px solid #0f2a40", borderRadius: 4, fontSize: 9, fontFamily: "monospace" }}
                  formatter={(v, name) => [
                    name === "waves" ? `${v} m` : `${v} kt`,
                    name === "wind" ? "Wind" : name === "gusts" ? "Gusts" : "Waves",
                  ]}
                  labelFormatter={l => l + " UTC"}
                />
                <Area type="monotone" dataKey="wind"  stroke="#00d4ff" fill="#00d4ff11" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="gusts" stroke="#f59e0b" fill="none"      strokeWidth={1} strokeDasharray="3 2" dot={false} />
                <Area type="monotone" dataKey="waves" stroke="#7c3aed" fill="#7c3aed0a" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 mt-1">
            {[["Wind","#00d4ff"],["Gusts","#f59e0b"],["Waves (m)","#7c3aed"]].map(([l,c]) => (
              <div key={l} className="flex items-center gap-1">
                <span style={{ width: 12, height: 2, background: c, display: "inline-block", borderRadius: 1 }} />
                <span style={{ fontFamily: "monospace", fontSize: 8, color: "#64748b" }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {riskMod >= 10 && (
        <div
          style={{
            fontFamily: "monospace", fontSize: 9, padding: "4px 8px", borderRadius: 4,
            background: riskMod >= 20 ? "#2a050522" : "#1a0a0522",
            border: `1px solid ${riskMod >= 20 ? "#ef4444" : "#f97316"}`,
            color: riskMod >= 20 ? "#ef4444" : "#f97316",
          }}
        >
          ⚠ Adverse conditions — Beaufort {wx.beaufort} / {wx.wave_m} m waves
          may affect VLCC transit through the narrows
        </div>
      )}
    </div>
  );
}
