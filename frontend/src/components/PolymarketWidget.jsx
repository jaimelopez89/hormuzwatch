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

  if (loading) {
    return (
      <div className="panel">
        <div className="panel-label">// Prediction Markets</div>
        <p className="text-xs text-dimtext italic">Loading Polymarket data…</p>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="panel">
        <div className="panel-label">// Prediction Markets</div>
        <p className="text-xs text-dimtext italic">No active Hormuz markets on Polymarket.</p>
        <p className="text-xs text-dimtext mt-1">
          <a
            href="https://polymarket.com/search?query=hormuz"
            target="_blank" rel="noopener noreferrer"
            style={{ color: "#00d4ff" }}
          >
            Browse Polymarket Hormuz markets ↗
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="panel flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="panel-label mb-0">// Prediction Markets</div>
        <a
          href="https://polymarket.com/search?query=hormuz"
          target="_blank" rel="noopener noreferrer"
          className="font-mono text-xs ml-auto"
          style={{ color: "#00d4ff", opacity: 0.7 }}
        >
          polymarket.com ↗
        </a>
      </div>

      {markets.map((m, i) => {
        const yes = m.yes_probability || 0;
        const no = 100 - yes;
        const yesColor = yes >= 70 ? "#22c55e" : yes >= 40 ? "#f59e0b" : "#ef4444";
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <p className="text-xs text-bright leading-snug">{m.question || m.name}</p>
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
            {m.end_date && (
              <p className="text-xs text-dimtext font-mono">
                Resolves: {m.end_date?.slice(0, 10)} · Vol: ${Number(m.volume || 0).toLocaleString()}
              </p>
            )}
          </div>
        );
      })}

      <div className="font-mono text-xs text-dimtext" style={{ opacity: 0.5 }}>
        Prediction markets price collective intelligence on outcomes.
        Price = implied probability.
      </div>
    </div>
  );
}
