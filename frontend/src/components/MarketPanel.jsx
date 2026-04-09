const PRECEDENTS = [
  { date: "Jun 2019", event: "Tanker Attacks", impact: "Brent +$10" },
  { date: "Jan 2012", event: "Sanctions Threat", impact: "WTI +15%" },
  { date: "Dec 2011", event: "Closure Threat", impact: "Brent +$5" },
  { date: "Sep 2019", event: "Abqaiq Attack", impact: "WTI +15% intraday" },
];

const FEATURED = ["CL=F", "BZ=F", "FRO", "STNG"];

function Tick({ tick }) {
  const up = tick.change_pct >= 0;
  return (
    <div className="flex items-center justify-between py-1 border-b border-border last:border-0">
      <div>
        <span className="font-mono text-xs text-bright">{tick.symbol}</span>
        <span className="text-xs text-dimtext ml-2">{tick.name}</span>
      </div>
      <div className="text-right">
        <span className="font-mono text-sm text-bright">${tick.price}</span>
        <span className={`font-mono text-xs ml-2 ${up ? "text-low" : "text-critical"}`}>
          {up ? "▲" : "▼"} {Math.abs(tick.change_pct)}%
        </span>
      </div>
    </div>
  );
}

export function MarketPanel({ market }) {
  const ticks = FEATURED.map((sym) => market[sym]).filter(Boolean);
  const allTicks = Object.values(market).filter((t) => !FEATURED.includes(t.symbol));

  return (
    <div className="flex flex-col gap-3">
      <div className="panel">
        <div className="panel-label">// Market Signals</div>
        {ticks.length === 0
          ? <p className="text-xs text-dimtext italic">Awaiting market data…</p>
          : ticks.map((t) => <Tick key={t.symbol} tick={t} />)
        }
        {allTicks.map((t) => <Tick key={t.symbol} tick={t} />)}
      </div>

      <div className="panel">
        <div className="panel-label">// Historical Context</div>
        <div className="flex flex-col gap-1.5">
          {PRECEDENTS.map((p) => (
            <div key={p.date} className="flex items-start justify-between">
              <div>
                <span className="font-mono text-xs text-primary">{p.date}</span>
                <span className="text-xs text-dimtext ml-2">{p.event}</span>
              </div>
              <span className="font-mono text-xs text-medium ml-2 whitespace-nowrap">{p.impact}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
