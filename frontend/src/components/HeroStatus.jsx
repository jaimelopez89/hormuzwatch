import { useEffect, useRef, useState } from "react";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const OPEN_CONFIG = {
  YES: {
    answer: "YES",
    label: "STRAIT OPEN",
    sub: "Traffic flowing at normal levels",
    color: "#22c55e",
    glow: "0 0 30px #22c55e33",
    pulse: false,
  },
  NO: {
    answer: "NO",
    label: "DISRUPTED",
    sub: "Significant reduction in transit traffic",
    color: "#ef4444",
    glow: "0 0 30px #ef444444",
    pulse: true,
  },
  UNCERTAIN: {
    answer: "?",
    label: "UNCERTAIN",
    sub: "Insufficient data — monitoring active",
    color: "#f59e0b",
    glow: "0 0 20px #f59e0b33",
    pulse: false,
  },
};

function Signal({ label, value, color, detail }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2.5 py-1 rounded"
      style={{ background: "#ffffff06", border: "1px solid #ffffff0a", minWidth: 80 }}>
      <div className="font-mono tracking-wider" style={{ color: "#64748b", fontSize: 8 }}>{label}</div>
      <div className="font-mono font-bold leading-tight" style={{ color: color || "#e2e8f0", fontSize: 13 }}>{value ?? "—"}</div>
      {detail && <div className="font-mono" style={{ fontSize: 8, color: "#4a5568" }}>{detail}</div>}
    </div>
  );
}

function RiskSparkline({ data }) {
  if (!data || data.length < 2) return null;
  return (
    <div style={{ width: 60, height: 28 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="score"
            stroke="#f59e0b"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Tooltip
            contentStyle={{ background: "#060d18", border: "1px solid #0f2a40", borderRadius: 4, fontSize: 9, fontFamily: "monospace" }}
            itemStyle={{ color: "#f59e0b" }}
            labelFormatter={() => ""}
            formatter={(v) => [`${v}/100`, "risk"]}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HeroStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [blinkOn, setBlinkOn] = useState(true);
  const [riskHistory, setRiskHistory] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/status`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setStatus(d); setLoading(false); } })
      .catch(() => setLoading(false));

    fetch(`${API}/api/risk/history`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setRiskHistory(d))
      .catch(() => {});

    function connect() {
      const es = new EventSource(`${API}/stream/status`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          setStatus(d);
          setLoading(false);
          // Append new risk point to sparkline
          if (d.risk_score != null) {
            setRiskHistory(prev => {
              const next = [...prev, { ts: Date.now() / 1000, score: d.risk_score, level: d.risk_level }];
              return next.slice(-288);
            });
          }
        } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();

    const blink = setInterval(() => setBlinkOn(b => !b), 700);
    return () => { esRef.current?.close(); clearInterval(blink); };
  }, []);

  const cfg = OPEN_CONFIG[status?.is_open ?? "UNCERTAIN"];
  const { color, glow, pulse } = cfg;

  const vessels   = status?.active_vessels;
  const pwPct     = status?.portwatch_pct;
  const pwDate    = status?.portwatch_latest_date;
  const polyPct   = status?.polymarket_yes_pct;
  const riskScore = status?.risk_score ?? 5;
  const riskLevel = status?.risk_level ?? "LOW";
  const confidence = status?.confidence ?? "LOW";

  const riskColor = riskLevel === "CRITICAL" ? "#ef4444" : riskLevel === "HIGH" ? "#f97316" : riskLevel === "ELEVATED" ? "#f59e0b" : "#22c55e";
  const pwColor   = pwPct == null ? "#64748b" : pwPct >= 80 ? "#22c55e" : pwPct >= 45 ? "#f59e0b" : "#ef4444";

  const brentPrice  = status?.brent_price;
  const brentChange = status?.brent_change_pct;
  const brentColor  = brentChange == null ? "#64748b" : brentChange > 2 ? "#ef4444" : brentChange > 0 ? "#f59e0b" : brentChange < -2 ? "#22c55e" : "#94a3b8";
  const brentLabel  = brentPrice != null
    ? `$${brentPrice.toFixed(1)}`
    : null;
  const brentDetail = brentChange != null
    ? `${brentChange > 0 ? "+" : ""}${brentChange.toFixed(1)}% today`
    : "Brent crude";

  return (
    <div
      className="w-full flex items-center gap-6 px-6 py-3 shrink-0"
      style={{ background: `linear-gradient(90deg, ${color}08 0%, transparent 60%)`, borderBottom: "1px solid #0f2a40" }}
    >
      {/* Big answer — left-anchored */}
      <div
        className="font-mono font-black leading-none select-all cursor-pointer shrink-0"
        style={{
          fontSize: "clamp(36px, 5vw, 56px)",
          color,
          textShadow: glow,
          opacity: pulse ? (blinkOn ? 1 : 0.6) : 1,
        }}
        title="Click to copy status"
        onClick={() => navigator.clipboard?.writeText(
          `Is the Strait of Hormuz open? ${cfg.answer} — ${cfg.label} | ${window.location.href}`
        )}
      >
        {loading ? "…" : cfg.answer}
      </div>

      {/* Label + question stack */}
      <div className="flex flex-col shrink-0">
        <div className="font-mono tracking-widest" style={{ fontSize: 9, color, opacity: 0.6 }}>
          IS HORMUZ OPEN?
        </div>
        <div className="font-mono font-bold" style={{ color, fontSize: 11, letterSpacing: "0.15em" }}>
          {cfg.label}
        </div>
        <div style={{ fontSize: 10, color: "#64748b" }}>
          {cfg.sub}
          {confidence === "LOW" && status && (
            <span style={{ color: "#374151" }}> · low confidence</span>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="w-px self-stretch shrink-0" style={{ background: "#0f2a40" }} />

      {/* Signal pills — horizontal scroll on narrow screens */}
      <div className="flex gap-2 overflow-x-auto flex-1 min-w-0">
        <Signal
          label="VESSELS IN AOR"
          value={vessels ?? "—"}
          color="#00d4ff"
          detail="live AIS"
        />
        {pwPct != null ? (
          <Signal
            label="TRANSIT FLOW"
            value={`${pwPct}%`}
            color={pwColor}
            detail={`of baseline${pwDate ? " · " + pwDate : ""}`}
          />
        ) : (
          <Signal label="IMF PORTWATCH" value="…" color="#374151" detail="transit data" />
        )}
        {polyPct != null && (
          <Signal
            label="PREDICTION MKT"
            value={`${polyPct}%`}
            color={polyPct >= 70 ? "#22c55e" : polyPct >= 40 ? "#f59e0b" : "#ef4444"}
            detail="Kalshi · Polymarket YES"
          />
        )}
        {brentLabel != null && (
          <Signal
            label="BRENT CRUDE"
            value={brentLabel}
            color={brentColor}
            detail={brentDetail}
          />
        )}
        <div className="flex flex-col items-center gap-0.5 px-2.5 py-1 rounded"
          style={{ background: "#ffffff06", border: "1px solid #ffffff0a", minWidth: 80 }}>
          <div className="font-mono tracking-wider" style={{ color: "#64748b", fontSize: 8 }}>RISK INDEX</div>
          <div className="font-mono font-bold leading-none" style={{ color: riskColor, fontSize: 13 }}>{riskScore}/100</div>
          <RiskSparkline data={riskHistory} />
        </div>
      </div>
    </div>
  );
}
