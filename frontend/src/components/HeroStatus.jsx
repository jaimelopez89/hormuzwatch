import { useEffect, useRef, useState } from "react";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const OPEN_CONFIG = {
  YES: {
    answer: "YES",
    label: "STRAIT OPEN",
    sub: "Traffic flowing at normal levels",
    color: "#22c55e",
    glow: "0 0 40px #22c55e44",
    pulse: false,
  },
  NO: {
    answer: "NO",
    label: "DISRUPTED",
    sub: "Significant reduction in transit traffic",
    color: "#ef4444",
    glow: "0 0 40px #ef444466",
    pulse: true,
  },
  UNCERTAIN: {
    answer: "?",
    label: "UNCERTAIN",
    sub: "Insufficient data — monitoring active",
    color: "#f59e0b",
    glow: "0 0 30px #f59e0b44",
    pulse: false,
  },
};

const SIGNAL_COLORS = {
  DISRUPTED: "#ef4444",
  REDUCED:   "#f59e0b",
  OPEN:      "#22c55e",
};

function SignalChip({ label, value, signal }) {
  const c = SIGNAL_COLORS[signal] || "#64748b";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      fontFamily: "monospace", fontSize: 9,
      background: `${c}12`,
      border: `1px solid ${c}44`,
      borderRadius: 3, padding: "2px 7px",
      whiteSpace: "nowrap",
    }}>
      <span style={{ color: "#94a3b8", letterSpacing: "0.08em" }}>{label}</span>
      <span style={{ color: c, fontWeight: 700 }}>{signal ?? "—"}</span>
      {value && <span style={{ color: "#64748b" }}>· {value}</span>}
    </div>
  );
}

function Metric({ label, value, color, detail, wide }) {
  return (
    <div
      className="flex flex-col justify-between"
      style={{
        background: "#ffffff05",
        border: "1px solid #ffffff0d",
        borderRadius: 6,
        padding: "7px 14px",
        minWidth: wide ? 110 : 88,
        gap: 2,
      }}
    >
      <div style={{ fontFamily: "monospace", fontSize: 8, letterSpacing: "0.15em", color: "#94a3b8", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 18, color: color || "#e2e8f0", lineHeight: 1, letterSpacing: "-0.01em" }}>
        {value ?? "—"}
      </div>
      {detail && (
        <div style={{ fontFamily: "monospace", fontSize: 9, color: "#94a3b8" }}>
          {detail}
        </div>
      )}
    </div>
  );
}

function RiskSparkline({ data }) {
  if (!data || data.length < 2) return null;
  return (
    <div style={{ width: 72, height: 36 }}>
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
  const [status, setStatus]           = useState(null);
  const [loading, setLoading]         = useState(true);
  const [blinkOn, setBlinkOn]         = useState(true);
  const [riskHistory, setRiskHistory] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/status`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setStatus(d); setLoading(false); } })
      .catch(() => setLoading(false));

    fetch(`${API}/api/risk/history`)
      .then(r => r.ok ? r.json() : [])
      .then(setRiskHistory)
      .catch(() => {});

    function connect() {
      const es = new EventSource(`${API}/stream/status`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          setStatus(d);
          setLoading(false);
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

  const riskScore   = status?.risk_score         ?? 5;
  const riskLevel   = status?.risk_level         ?? "LOW";
  const confidence  = status?.confidence         ?? "LOW";
  const pwPct       = status?.portwatch_pct;
  const pwDate      = status?.portwatch_latest_date;
  const polyPct     = status?.polymarket_yes_pct;
  const vessels     = status?.active_vessels;
  const brentPrice  = status?.brent_price;
  const brentChange = status?.brent_change_pct;
  const signals     = status?.signals ?? {};

  const riskColor  = riskLevel === "CRITICAL" ? "#ef4444" : riskLevel === "HIGH" ? "#f97316" : riskLevel === "ELEVATED" ? "#f59e0b" : "#22c55e";
  const pwColor    = pwPct == null ? "#64748b" : pwPct >= 80 ? "#22c55e" : pwPct >= 45 ? "#f59e0b" : "#ef4444";
  const brentColor = brentChange == null ? "#64748b" : brentChange > 2 ? "#ef4444" : brentChange > 0 ? "#f59e0b" : brentChange < -2 ? "#22c55e" : "#94a3b8";

  const hasSignals = signals.portwatch || signals.polymarket || signals.risk;

  return (
    <div
      className="w-full flex items-stretch gap-0 shrink-0"
      style={{
        background: `linear-gradient(90deg, ${color}0d 0%, #030810 50%)`,
        borderBottom: "1px solid #0f2a40",
        minHeight: hasSignals ? 90 : 72,
      }}
    >
      {/* Status answer — left anchor */}
      <div
        className="flex items-center gap-5 px-6 shrink-0 border-r"
        style={{ borderColor: `${color}33` }}
      >
        {/* Big YES / NO */}
        <div
          className="font-mono font-black select-all cursor-pointer leading-none"
          style={{
            fontSize: "clamp(40px, 5vw, 60px)",
            color,
            textShadow: glow,
            opacity: pulse ? (blinkOn ? 1 : 0.5) : 1,
            transition: "opacity 0.15s",
          }}
          title="Click to copy status"
          onClick={() => navigator.clipboard?.writeText(
            `Is the Strait of Hormuz open? ${cfg.answer} — ${cfg.label} | ${window.location.href}`
          )}
        >
          {loading ? "…" : cfg.answer}
        </div>

        {/* Status label stack */}
        <div className="flex flex-col gap-0.5">
          <div style={{ fontFamily: "monospace", fontSize: 9, letterSpacing: "0.2em", color: "#94a3b8" }}>
            STRAIT OF HORMUZ
          </div>
          <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, letterSpacing: "0.12em", color }}>
            {cfg.label}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#94a3b8" }}>
            {cfg.sub}
            {confidence === "LOW" && status && (
              <span style={{ color: "#334155" }}> · low confidence</span>
            )}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px self-stretch" style={{ background: "#0f2a40" }} />

      {/* Metric pills + signal factors */}
      <div className="flex flex-col flex-1 min-w-0 justify-center">
        {/* Metric row */}
        <div className="flex items-center gap-2 px-5 pt-2 pb-1 overflow-x-auto">
          <Metric
            label="Vessels in AOR"
            value={vessels ?? "—"}
            color="#00d4ff"
            detail="live AIS"
          />
          {pwPct != null ? (
            <Metric
              label="Transit Flow"
              value={`${pwPct}%`}
              color={pwColor}
              detail={`of baseline${pwDate ? " · " + pwDate : ""}`}
              wide
            />
          ) : (
            <Metric label="Transit Flow" value="…" color="#334155" detail="IMF PortWatch" />
          )}
          {polyPct != null && (
            <Metric
              label="Closure Risk"
              value={`${polyPct}%`}
              color={polyPct >= 70 ? "#ef4444" : polyPct >= 40 ? "#f59e0b" : "#22c55e"}
              detail="prediction markets"
              wide
            />
          )}
          {brentPrice != null && (
            <Metric
              label="Brent Crude"
              value={`$${brentPrice.toFixed(1)}`}
              color={brentColor}
              detail={brentChange != null ? `${brentChange > 0 ? "+" : ""}${brentChange.toFixed(1)}% today` : ""}
            />
          )}

          {/* Risk index with sparkline */}
          <div
            style={{
              background: "#ffffff05",
              border: `1px solid ${riskColor}33`,
              borderRadius: 6,
              padding: "7px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minWidth: 110,
            }}
          >
            <div style={{ fontFamily: "monospace", fontSize: 8, letterSpacing: "0.15em", color: "#94a3b8" }}>
              RISK INDEX
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 18, color: riskColor, lineHeight: 1 }}>
                {riskScore}/100
              </div>
              <RiskSparkline data={riskHistory} />
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: riskColor, opacity: 0.7 }}>
              {riskLevel}
            </div>
          </div>
        </div>

        {/* Signal factors strip */}
        {status && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 20px 6px", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontSize: 8, letterSpacing: "0.12em", color: "#64748b", marginRight: 2 }}>
              FACTORS ›
            </span>
            {signals.portwatch
              ? <SignalChip label="PORTWATCH" signal={signals.portwatch} value={pwPct != null ? `${pwPct}% of baseline` : undefined} />
              : <SignalChip label="PORTWATCH" signal={null} value="no data" />
            }
            {polyPct != null && (
              <SignalChip label="MARKETS" signal={signals.polymarket} value={`${polyPct}% closure`} />
            )}
            {signals.risk
              ? <SignalChip label="INTEL" signal={signals.risk} value="events contributing" />
              : <SignalChip label="INTEL" signal={null} value="no active alerts" />
            }
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "#334155" }}>
              · score decays 6pt/h without new events
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
