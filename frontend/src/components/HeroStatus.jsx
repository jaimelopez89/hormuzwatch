import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const OPEN_CONFIG = {
  YES: {
    answer: "YES",
    label: "STRAIT IS OPEN",
    sub: "Traffic flowing normally",
    color: "#22c55e",
    glow: "0 0 40px #22c55e33, 0 0 80px #22c55e11",
    border: "#22c55e44",
    bg: "#22c55e08",
    pulse: false,
  },
  NO: {
    answer: "NO",
    label: "STRAIT COMPROMISED",
    sub: "Significant disruption detected",
    color: "#ef4444",
    glow: "0 0 40px #ef444444, 0 0 80px #ef444422",
    border: "#ef444466",
    bg: "#ef444408",
    pulse: true,
  },
  UNCERTAIN: {
    answer: "?",
    label: "STATUS UNCERTAIN",
    sub: "Conflicting signals — monitor closely",
    color: "#f59e0b",
    glow: "0 0 30px #f59e0b33, 0 0 60px #f59e0b11",
    border: "#f59e0b44",
    bg: "#f59e0b08",
    pulse: false,
  },
};

function Signal({ label, value, color, sub }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-4 py-2 rounded"
      style={{ background: "#ffffff06", border: "1px solid #ffffff0f" }}>
      <div className="font-mono text-xs tracking-widest text-dimtext">{label}</div>
      <div className="font-mono font-bold text-base" style={{ color: color || "#e2e8f0" }}>{value}</div>
      {sub && <div className="text-xs text-dimtext">{sub}</div>}
    </div>
  );
}

export function HeroStatus() {
  const [status, setStatus] = useState(null);
  const [blinkOn, setBlinkOn] = useState(true);
  const esRef = useRef(null);

  useEffect(() => {
    // Initial fetch
    fetch(`${API}/api/status`).then(r => r.ok ? r.json() : null).then(d => d && setStatus(d)).catch(() => {});

    // SSE for live updates
    function connect() {
      const es = new EventSource(`${API}/stream/status`);
      esRef.current = es;
      es.onmessage = (e) => { try { setStatus(JSON.parse(e.data)); } catch {} };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();

    // Blink for CRITICAL state
    const blink = setInterval(() => setBlinkOn(b => !b), 800);
    return () => { esRef.current?.close(); clearInterval(blink); };
  }, []);

  const cfg = OPEN_CONFIG[status?.is_open || "UNCERTAIN"];
  const { color, glow, border, bg, pulse } = cfg;

  const polyPct = status?.polymarket_yes_pct;
  const pwPct = status?.portwatch_pct;
  const vessels = status?.active_vessels || 0;
  const risk = status?.risk_level || "UNKNOWN";
  const riskScore = status?.risk_score || 0;

  return (
    <div
      className="relative w-full flex flex-col items-center justify-center py-8 px-4"
      style={{ background: `radial-gradient(ellipse at center, ${color}06 0%, transparent 70%)` }}
    >
      {/* Decorative top border */}
      <div className="w-full h-px mb-6" style={{ background: `linear-gradient(90deg, transparent, ${color}44, transparent)` }} />

      {/* Question */}
      <div
        className="font-mono tracking-widest text-center mb-2"
        style={{ fontSize: 11, letterSpacing: "0.3em", color: color, opacity: 0.7 }}
      >
        IS THE STRAIT OF HORMUZ OPEN?
      </div>

      {/* BIG ANSWER */}
      <div
        className="font-mono font-black text-center leading-none mb-3 select-all"
        style={{
          fontSize: "clamp(60px, 12vw, 120px)",
          color: color,
          textShadow: glow,
          opacity: pulse ? (blinkOn ? 1 : 0.7) : 1,
          letterSpacing: "0.05em",
          cursor: "pointer",
        }}
        title="Click to copy current status"
        onClick={() => navigator.clipboard?.writeText(`Is the Strait of Hormuz open? ${cfg.answer} — ${cfg.label}. Live at hormuzwatch.io`)}
      >
        {cfg.answer}
      </div>

      {/* Label + sub */}
      <div className="font-mono font-bold text-center mb-1" style={{ color, fontSize: 13, letterSpacing: "0.15em" }}>
        {cfg.label}
      </div>
      <div className="text-sm text-dimtext text-center mb-6">{cfg.sub}</div>

      {/* Signal indicators */}
      <div className="flex flex-wrap gap-2 justify-center mb-4">
        <Signal
          label="ACTIVE VESSELS"
          value={vessels || "—"}
          color="#00d4ff"
          sub="in AOR"
        />
        {pwPct != null && (
          <Signal
            label="TRANSIT FLOW"
            value={`${pwPct}%`}
            color={pwPct >= 85 ? "#22c55e" : pwPct >= 50 ? "#f59e0b" : "#ef4444"}
            sub="of 90d baseline"
          />
        )}
        {polyPct != null && (
          <Signal
            label="MARKETS SAY"
            value={`${polyPct}% YES`}
            color={polyPct >= 70 ? "#22c55e" : polyPct >= 40 ? "#f59e0b" : "#ef4444"}
            sub="Polymarket odds"
          />
        )}
        <Signal
          label="THREAT INDEX"
          value={`${riskScore}/100`}
          color={risk === "CRITICAL" ? "#ef4444" : risk === "HIGH" ? "#f97316" : risk === "ELEVATED" ? "#f59e0b" : "#22c55e"}
          sub={risk}
        />
        {status?.portwatch_latest_date && (
          <Signal
            label="IMF DATA AS OF"
            value={status.portwatch_latest_date}
            color="#64748b"
            sub="PortWatch lag ~4 days"
          />
        )}
      </div>

      {/* Data sources credit */}
      <div className="font-mono text-xs text-dimtext text-center" style={{ opacity: 0.5 }}>
        Sources: AISStream · IMF PortWatch · Polymarket · Reuters · USNI · LLM synthesis
      </div>

      {/* Bottom border */}
      <div className="w-full h-px mt-6" style={{ background: `linear-gradient(90deg, transparent, ${color}22, transparent)` }} />
    </div>
  );
}
