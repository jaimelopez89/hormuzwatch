import { formatDistanceToNow } from "date-fns";

function ConfidenceBadge({ confidence }) {
  const colors = { HIGH: "text-low", MEDIUM: "text-medium", LOW: "text-high" };
  return <span className={`font-mono text-xs ${colors[confidence] || "text-dimtext"}`}>{confidence}</span>;
}

export function BriefingPanel({ briefing }) {
  if (!briefing) {
    return (
      <div className="panel flex flex-col gap-2">
        <div className="panel-label">// AI Situation Report</div>
        <p className="text-xs text-dimtext italic">Awaiting first intelligence synthesis…</p>
      </div>
    );
  }

  const ago = briefing.generated_at
    ? formatDistanceToNow(new Date(briefing.generated_at), { addSuffix: true })
    : "";

  return (
    <div className="panel flex flex-col gap-3">
      <div className="panel-label">// AI Situation Report</div>
      {briefing.headline
        ? <p className="text-sm text-bright font-semibold leading-tight">{briefing.headline}</p>
        : null
      }
      <div className="text-xs text-dimtext leading-relaxed whitespace-pre-line">
        {briefing.body || briefing.text || "No briefing content."}
      </div>

      {briefing.key_drivers?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {briefing.key_drivers.map((d, i) => (
            <span key={i} className="text-xs bg-border text-primary px-2 py-0.5 rounded font-mono">{d}</span>
          ))}
        </div>
      )}

      {briefing.market_outlook && (
        <div className="border-l-2 border-primary pl-2">
          <p className="text-xs text-dimtext italic">{briefing.market_outlook}</p>
        </div>
      )}

      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-1 text-xs text-dimtext font-mono">
          Confidence: <ConfidenceBadge confidence={briefing.confidence} />
        </div>
        <span className="text-xs text-dimtext font-mono">{ago}</span>
      </div>
    </div>
  );
}
