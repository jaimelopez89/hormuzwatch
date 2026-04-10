const PRECEDENTS = [
  { date: "Jun 2019", event: "Tanker Attacks",     impact: "Brent +$10" },
  { date: "Jan 2012", event: "Sanctions Threat",   impact: "WTI +15%" },
  { date: "Dec 2011", event: "Closure Threat",     impact: "Brent +$5" },
  { date: "Sep 2019", event: "Abqaiq Attack",      impact: "WTI +15% intraday" },
  { date: "Apr 2024", event: "Iran–Israel Strikes", impact: "Oil +3.5%" },
];

const GROUPS = [
  { label: "Crude",   symbols: ["CL=F", "BZ=F"] },
  { label: "Tankers", symbols: ["FRO", "STNG", "DHT", "TK", "NAT"] },
  { label: "Majors",  symbols: ["XOM", "CVX", "BP", "SHEL", "TTE"] },
  { label: "Defence", symbols: ["ITA", "LMT", "RTX"] },
  { label: "Shipping",symbols: ["ZIM"] },
];

function Tick({ tick }) {
  const up = tick.change_pct >= 0;
  const big = Math.abs(tick.change_pct) >= 3; // noteworthy move
  return (
    <div
      className="flex items-center justify-between py-0.5 border-b border-border last:border-0"
      style={big ? { background: up ? "#22c55e0a" : "#ef44440a" } : {}}
    >
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="font-mono text-xs text-bright shrink-0">{tick.symbol}</span>
        <span className="text-xs text-dimtext truncate">{tick.name}</span>
      </div>
      <div className="text-right shrink-0 ml-2">
        <span className="font-mono text-xs text-bright">${tick.price}</span>
        <span className={`font-mono text-xs ml-1.5 ${up ? "text-low" : "text-critical"}`}>
          {up ? "▲" : "▼"}{Math.abs(tick.change_pct)}%
        </span>
      </div>
    </div>
  );
}

function Group({ label, symbols, market }) {
  const ticks = symbols.map((s) => market[s]).filter(Boolean);
  if (ticks.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="font-mono text-xs text-dimtext tracking-widest mb-1 opacity-60">{label}</div>
      {ticks.map((t) => <Tick key={t.symbol} tick={t} />)}
    </div>
  );
}

export function MarketPanel({ market }) {
  const hasData = Object.keys(market).length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="panel">
        <div className="panel-label">// Market Signals</div>
        {!hasData ? (
          <p className="text-xs text-dimtext italic">Awaiting market data…</p>
        ) : (
          GROUPS.map((g) => <Group key={g.label} {...g} market={market} />)
        )}
      </div>

      <div className="panel">
        <div className="panel-label">// Historical Precedents</div>
        <div className="flex flex-col gap-1.5">
          {PRECEDENTS.map((p) => (
            <div key={p.date} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono text-xs text-primary">{p.date}</span>
                <span className="text-xs text-dimtext ml-2">{p.event}</span>
              </div>
              <span className="font-mono text-xs text-medium shrink-0">{p.impact}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
