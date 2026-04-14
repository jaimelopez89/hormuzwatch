import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function ProbabilityBar({ pct, color }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "#0f2a40" }}>
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums" style={{ color, minWidth: 36, textAlign: "right" }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

const SOURCE_META = {
  kalshi: { label: "KALSHI", href: "https://kalshi.com", color: "#a78bfa" },
  default: { label: "POLYMARKET", href: "https://polymarket.com", color: "#00d4ff" },
};

function SourceBadge({ source }) {
  const meta = SOURCE_META[source] || SOURCE_META.default;
  return (
    <a
      href={meta.href}
      target="_blank" rel="noopener noreferrer"
      className="font-mono text-xs px-1 py-0.5 rounded"
      style={{ color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}33`, fontSize: 9 }}
    >
      {meta.label}
    </a>
  );
}

export function PolymarketWidget() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function load() {
      fetch(`${API}/api/polymarket`)
        .then(r => r.ok ? r.json() : [])
        .then(d => { setMarkets(Array.isArray(d) ? d : []); setLoading(false); })
        .catch(() => setLoading(false));
    }
    load();
    const i = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(i);
  }, []);

  const kalshiMarkets = markets.filter(m => m.source === "kalshi");
  const polyMarkets = markets.filter(m => m.source !== "kalshi");

  if (loading) {
    return (
      <div className="panel">
        <div className="panel-label">// Prediction Markets</div>
        <p className="text-xs text-dimtext italic">Loading…</p>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="panel">
        <div className="panel-label">// Prediction Markets</div>
        <p className="text-xs text-dimtext italic">No active Iran/Hormuz markets found.</p>
        <div className="flex gap-3 mt-2">
          <a href="https://polymarket.com/search?query=hormuz" target="_blank" rel="noopener noreferrer"
            className="font-mono text-xs" style={{ color: "#00d4ff" }}>Polymarket ↗</a>
          <a href="https://kalshi.com/markets/iran" target="_blank" rel="noopener noreferrer"
            className="font-mono text-xs" style={{ color: "#a78bfa" }}>Kalshi ↗</a>
        </div>
      </div>
    );
  }

  return (
    <div className="panel flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="panel-label mb-0">// Prediction Markets</div>
        <span className="font-mono text-xs text-dimtext ml-auto">
          {markets.length} active contract{markets.length !== 1 ? "s" : ""}
        </span>
      </div>

      {markets.map((m, i) => {
        const yes = m.yes_probability ?? 0;
        const no = 100 - yes;
        const yesColor = yes >= 70 ? "#22c55e" : yes >= 40 ? "#f59e0b" : "#ef4444";
        return (
          <div key={i} className="flex flex-col gap-1.5 pb-2" style={{ borderBottom: "1px solid #0f2a4044" }}>
            <div className="flex items-start gap-2">
              <p className="text-xs text-bright leading-snug flex-1">{m.question || m.name}</p>
              <SourceBadge source={m.source} />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-dimtext w-6 shrink-0">YES</span>
                <ProbabilityBar pct={yes} color={yesColor} />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-dimtext w-6 shrink-0">NO</span>
                <ProbabilityBar pct={no} color="#ef4444" />
              </div>
            </div>
            {(m.end_date || m.volume > 0) && (
              <p className="font-mono text-xs text-dimtext" style={{ opacity: 0.6 }}>
                {m.end_date ? `Resolves: ${String(m.end_date).slice(0, 10)}` : ""}
                {m.volume > 0 ? ` · Vol: $${Number(m.volume).toLocaleString()}` : ""}
                {m.open_interest > 0 ? ` · OI: $${Number(m.open_interest).toLocaleString()}` : ""}
              </p>
            )}
          </div>
        );
      })}

      <div className="font-mono text-xs text-dimtext" style={{ opacity: 0.45 }}>
        Prediction markets reflect collective probability estimates.
      </div>
    </div>
  );
}
