import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const SEV_STYLE = {
  CRITICAL: { color: "#ef4444", dot: "#ef4444", glow: "#ef444433" },
  HIGH:     { color: "#f97316", dot: "#f97316", glow: "#f9731633" },
  MEDIUM:   { color: "#f59e0b", dot: "#f59e0b", glow: "#f59e0b22" },
  LOW:      { color: "#22c55e", dot: "#22c55e", glow: "transparent" },
};

const TYPE_ICONS = {
  DARK_AIS:           "📡",
  STS_RENDEZVOUS:     "🔄",
  SANCTIONS_HIT:      "🚨",
  MILITARY_PROXIMITY: "⚔️",
  TRAFFIC_ANOMALY:    "📊",
  SLOWDOWN:           "🐢",
  TANKER_CLUSTER:     "🛢️",
  NEWS_CORRELATION:   "📰",
};

function groupByDate(events) {
  const groups = {};
  for (const ev of events) {
    const date = ev.timestamp
      ? format(new Date(ev.timestamp), "yyyy-MM-dd")
      : "unknown";
    if (!groups[date]) groups[date] = [];
    groups[date].push(ev);
  }
  return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
}

export function IncidentTimeline() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/events?limit=200`)
      .then(r => r.ok ? r.json() : [])
      .then(d => { setEvents(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Only show CRITICAL + HIGH for timeline view (narrative-level events)
  const significant = events.filter(ev =>
    ev.severity === "CRITICAL" || ev.severity === "HIGH"
  );
  const groups = groupByDate(significant);

  return (
    <div className="panel">
      <div className="panel-label">// Incident Timeline</div>
      <p className="text-xs text-dimtext mb-3">CRITICAL &amp; HIGH severity events — last 200 messages</p>

      {loading && <p className="text-xs text-dimtext italic">Loading…</p>}

      {!loading && significant.length === 0 && (
        <p className="text-xs text-dimtext italic">No significant incidents recorded yet.</p>
      )}

      <div className="flex flex-col gap-4">
        {groups.map(([date, dayEvents]) => (
          <div key={date}>
            {/* Date header */}
            <div className="flex items-center gap-2 mb-2">
              <div className="font-mono text-xs font-bold" style={{ color: "#4a5568" }}>
                {date === "unknown" ? "Unknown Date" : format(new Date(date), "MMMM d, yyyy")}
              </div>
              <div className="flex-1 h-px" style={{ background: "#0f2a40" }} />
              <div className="font-mono text-xs" style={{ color: "#374151" }}>
                {dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}
              </div>
            </div>

            {/* Events for this day */}
            <div className="flex flex-col gap-1 ml-3">
              {dayEvents.map((ev, i) => {
                const sev   = SEV_STYLE[ev.severity] || SEV_STYLE.LOW;
                const icon  = TYPE_ICONS[ev.type] || "⚠️";
                const timeAgo = ev.timestamp
                  ? formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true })
                  : "";
                const timeStr = ev.timestamp
                  ? format(new Date(ev.timestamp), "HH:mm UTC")
                  : "";

                return (
                  <div key={i} className="flex items-start gap-3">
                    {/* Timeline line + dot */}
                    <div className="flex flex-col items-center shrink-0" style={{ marginTop: 3 }}>
                      <div
                        className="rounded-full"
                        style={{
                          width: 8, height: 8,
                          background: sev.dot,
                          boxShadow: `0 0 6px ${sev.glow}`,
                          flexShrink: 0,
                        }}
                      />
                      {i < dayEvents.length - 1 && (
                        <div style={{ width: 1, flex: 1, background: "#0f2a40", minHeight: 16, marginTop: 2 }} />
                      )}
                    </div>

                    {/* Event content */}
                    <div
                      className="flex-1 mb-1 px-2 py-1.5 rounded"
                      style={{
                        background: `${sev.glow}`,
                        border: `1px solid ${sev.color}22`,
                        minWidth: 0,
                      }}
                    >
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span style={{ fontSize: 11 }}>{icon}</span>
                        <span className="font-mono text-xs font-bold" style={{ color: sev.color }}>
                          {ev.severity}
                        </span>
                        <span className="font-mono text-xs" style={{ color: "#64748b" }}>
                          {ev.type?.replace(/_/g, " ") || "EVENT"}
                        </span>
                        {ev.mmsi && (
                          <span className="font-mono text-xs" style={{ color: "#374151" }}>
                            MMSI {ev.mmsi}
                          </span>
                        )}
                        <span className="font-mono text-xs ml-auto shrink-0" style={{ color: "#374151" }}>
                          {timeStr || timeAgo}
                        </span>
                      </div>
                      <p className="text-xs mt-0.5 leading-snug" style={{ color: "#94a3b8" }}>
                        {ev.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
