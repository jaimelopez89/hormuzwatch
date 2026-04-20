import { formatDistanceToNow } from "date-fns";
import Markdown from "react-markdown";

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

  const text = briefing.body || briefing.text || "";

  return (
    <div className="panel flex flex-col gap-3">
      <div className="panel-label">// AI Situation Report</div>
      <div className="briefing-md text-xs text-dimtext leading-relaxed">
        <Markdown>{text}</Markdown>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs font-mono" style={{ color: "#64748b" }}>
          {briefing.model || "AI"}
        </span>
        <span className="text-xs text-dimtext font-mono">{ago}</span>
      </div>
    </div>
  );
}
