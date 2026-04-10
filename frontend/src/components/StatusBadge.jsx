/**
 * StatusBadge — the headline "Is Hormuz Open?" indicator.
 * Derived from the current risk score/level.
 */
export function StatusBadge({ risk }) {
  const { score, level } = risk;

  let open, color, glow, label, sub;
  if (level === "CRITICAL") {
    open = "NO";
    color = "#ef4444";
    glow = "0 0 20px #ef444466";
    label = "STRAIT COMPROMISED";
    sub = "Closure risk — immediate threat";
  } else if (level === "HIGH") {
    open = "?";
    color = "#f97316";
    glow = "0 0 16px #f9731666";
    label = "STATUS UNCERTAIN";
    sub = "Elevated threat — monitor closely";
  } else if (level === "ELEVATED") {
    open = "?";
    color = "#f59e0b";
    glow = "0 0 12px #f59e0b44";
    label = "CAUTION ADVISED";
    sub = "Above baseline — situation developing";
  } else {
    open = "YES";
    color = "#22c55e";
    glow = "0 0 12px #22c55e44";
    label = "STRAIT OPEN";
    sub = "No immediate threat detected";
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1 rounded border"
      style={{ borderColor: color + "66", background: color + "11", boxShadow: glow }}>
      <div className="text-center leading-none">
        <div className="font-mono text-xs tracking-widest mb-0.5" style={{ color, opacity: 0.7 }}>
          IS HORMUZ OPEN?
        </div>
        <div className="font-mono font-bold text-2xl tracking-widest" style={{ color }}>
          {open}
        </div>
      </div>
      <div>
        <div className="font-mono text-xs font-bold tracking-wider" style={{ color }}>{label}</div>
        <div className="text-xs text-dimtext">{sub}</div>
      </div>
    </div>
  );
}
