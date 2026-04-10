import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const OPEN_CONFIG = {
  YES: {
    answer: "YES",
    label: "STRAIT OPEN",
    sub: "Traffic flowing at normal levels",
    color: "#22c55e",
    glow: "0 0 40px #22c55e33",
    pulse: false,
  },
  NO: {
    answer: "NO",
    label: "DISRUPTED",
    sub: "Significant reduction in transit traffic",
    color: "#ef4444",
    glow: "0 0 40px #ef444444",
    pulse: true,
  },
  UNCERTAIN: {
    answer: "?",
    label: "UNCERTAIN",
    sub: "Insufficient data — monitoring active",
    color: "#f59e0b",
    glow: "0 0 30px #f59e0b33",
    pulse: false,
  },
};

function Signal({ label, value, color, detail }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded"
      style={{ background: "#ffffff06", border: "1px solid #ffffff0a", minWidth: 90 }}>
      <div className="font-mono text-xs tracking-wider" style={{ color: "#64748b", fontSize: 9 }}>{label}</div>
      <div className="font-mono font-bold text-sm leading-tight" style={{ color: color || "#e2e8f0" }}>{value ?? "—"}</div>
      {detail && <div className="font-mono" style={{ fontSize: 9, color: "#4a5568" }}>{detail}</div>}
    </div>
  );
}

export function HeroStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [blinkOn, setBlinkOn] = useState(true);
  const esRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/status`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setStatus(d); setLoading(false); } })
      .catch(() => setLoading(false));

    function connect() {
      const es = new EventSource(`${API}/stream/status`);
      esRef.current = es;
      es.onmessage = (e) => {
        try { const d = JSON.parse(e.data); setStatus(d); setLoading(false); } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();

    const blink = setInterval(() => setBlinkOn(b => !b), 700);
    return () => { esRef.current?.close(); clearInterval(blink); };
  }, []);

  const cfg = OPEN_CONFIG[status?.is_open ?? "UNCERTAIN"];
  const { color, glow, pulse } = cfg;

  const vessels  = status?.active_vessels;
  const pwPct    = status?.portwatch_pct;
  const pwDate   = status?.portwatch_latest_date;
  const polyPct  = status?.polymarket_yes_pct;
  const riskScore = status?.risk_score ?? 5;
  const riskLevel = status?.risk_level ?? "LOW";
  const confidence = status?.confidence ?? "LOW";

  const riskColor = riskLevel === "CRITICAL" ? "#ef4444" : riskLevel === "HIGH" ? "#f97316" : riskLevel === "ELEVATED" ? "#f59e0b" : "#22c55e";
  const pwColor   = pwPct == null ? "#64748b" : pwPct >= 80 ? "#22c55e" : pwPct >= 45 ? "#f59e0b" : "#ef4444";

  return (
    <div className="w-full flex flex-col items-center py-6 px-4"
      style={{ background: `radial-gradient(ellipse 60% 80% at 50% 0%, ${color}07 0%, transparent 70%)` }}>

      {/* Thin gradient top line */}
      <div className="w-3/4 h-px mb-5" style={{ background: `linear-gradient(90deg, transparent, ${color}55, transparent)` }} />

      {/* Question */}
      <div className="font-mono tracking-widest mb-1" style={{ fontSize: 10, letterSpacing: "0.35em", color, opacity: 0.65 }}>
        IS THE STRAIT OF HORMUZ OPEN?
      </div>

      {/* BIG ANSWER */}
      <div
        className="font-mono font-black leading-none mb-2 select-all cursor-pointer"
        style={{
          fontSize: "clamp(56px, 10vw, 96px)",
          color,
          textShadow: glow,
          opacity: pulse ? (blinkOn ? 1 : 0.65) : 1,
          letterSpacing: "0.06em",
        }}
        title="Click to copy status"
        onClick={() => navigator.clipboard?.writeText(
          `Is the Strait of Hormuz open? ${cfg.answer} — ${cfg.label} | ${window.location.href}`
        )}
      >
        {loading ? "…" : cfg.answer}
      </div>

      {/* Status label */}
      <div className="font-mono font-bold mb-0.5" style={{ color, fontSize: 12, letterSpacing: "0.18em" }}>
        {cfg.label}
      </div>
      <div className="text-xs mb-4" style={{ color: "#64748b" }}>
        {cfg.sub}
        {confidence === "LOW" && status && (
          <span style={{ color: "#374151" }}> · confidence LOW</span>
        )}
      </div>

      {/* Signal pills */}
      <div className="flex flex-wrap gap-2 justify-center mb-4">
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
          <Signal label="IMF PORTWATCH" value="loading" color="#374151" detail="transit data" />
        )}
        {polyPct != null && (
          <Signal
            label="POLYMARKET"
            value={`${polyPct}%`}
            color={polyPct >= 70 ? "#22c55e" : polyPct >= 40 ? "#f59e0b" : "#ef4444"}
            detail="market YES odds"
          />
        )}
        <Signal
          label="RISK INDEX"
          value={`${riskScore}/100`}
          color={riskColor}
          detail={riskLevel}
        />
      </div>

      {/* Sources */}
      <div className="font-mono" style={{ fontSize: 9, color: "#374151", letterSpacing: "0.05em" }}>
        IMF PortWatch · AISStream · Polymarket · Reuters · USNI · 22 feeds · AI synthesis
      </div>

      <div className="w-3/4 h-px mt-5" style={{ background: `linear-gradient(90deg, transparent, ${color}22, transparent)` }} />
    </div>
  );
}
