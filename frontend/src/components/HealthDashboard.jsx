import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const SOURCE_LABELS = {
  aisstream:      { label: "AISStream",       desc: "Real-time AIS WebSocket" },
  marinetraffic:  { label: "MarineTraffic",   desc: "MT tile scraper" },
  portwatch:      { label: "IMF PortWatch",   desc: "Daily transit counts" },
  news:           { label: "News Poller",     desc: "RSS/Newsdata headlines" },
  markets:        { label: "Markets",         desc: "Yahoo Finance / commodities" },
  prediction_mkts:{ label: "Prediction Mkts", desc: "Polymarket · Kalshi" },
  synthesizer:    { label: "LLM Synthesizer", desc: "Claude briefing generator" },
};

const STATUS_STYLE = {
  ok:      { color: "#22c55e", label: "OK",    dot: "●" },
  stale:   { color: "#f59e0b", label: "STALE", dot: "●" },
  dead:    { color: "#ef4444", label: "DEAD",  dot: "●" },
  unknown: { color: "#374151", label: "—",     dot: "○" },
};

function formatAge(secs) {
  if (secs == null) return "—";
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${(secs / 3600).toFixed(1)}h ago`;
}

export function HealthDashboard() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    function fetch_health() {
      fetch(`${API}/health/details`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setHealth(d); })
        .catch(() => setError(true));
    }
    fetch_health();
    const iv = setInterval(fetch_health, 30_000);
    return () => clearInterval(iv);
  }, []);

  const sources = Object.entries(SOURCE_LABELS);

  return (
    <div className="panel">
      <div className="panel-label">// System Health</div>

      {/* Vessel count badge */}
      {health?.vessels_live != null && (
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-xs" style={{ color: "#64748b" }}>LIVE VESSELS</span>
          <span className="font-mono font-bold text-sm" style={{ color: "#00d4ff" }}>
            {health.vessels_live}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {sources.map(([key, meta]) => {
          const src   = health?.[key];
          const st    = src?.status ?? "unknown";
          const style = STATUS_STYLE[st] || STATUS_STYLE.unknown;
          const age   = src?.age_s;

          return (
            <div
              key={key}
              className="flex items-center gap-2 px-2 py-1.5 rounded"
              style={{ background: "#ffffff04", border: "1px solid #ffffff06" }}
            >
              <span style={{ color: style.color, fontSize: 10 }}>{style.dot}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-xs font-bold text-bright">{meta.label}</span>
                  <span className="font-mono text-xs text-dimtext">{meta.desc}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-xs" style={{ color: "#374151" }}>{formatAge(age)}</span>
                <span
                  className="font-mono text-xs font-bold px-1.5 py-0.5 rounded"
                  style={{
                    color: style.color,
                    background: `${style.color}18`,
                    border: `1px solid ${style.color}44`,
                    minWidth: 42,
                    textAlign: "center",
                  }}
                >
                  {style.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="mt-2 text-xs font-mono" style={{ color: "#ef4444" }}>
          ⚠ Could not reach /health/details
        </p>
      )}
      <p className="mt-2 text-xs font-mono text-dimtext">Refreshes every 30s</p>
    </div>
  );
}
