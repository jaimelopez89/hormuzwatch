import { formatDistanceToNow } from "date-fns";
import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const TYPE_META = {
  DARK_AIS:           { icon: "📡", label: "DARK AIS" },
  STS_RENDEZVOUS:     { icon: "🔄", label: "STS TRANSFER" },
  SANCTIONS_HIT:      { icon: "🚨", label: "SANCTIONS HIT" },
  MILITARY_PROXIMITY: { icon: "⚔️", label: "MILITARY" },
  TRAFFIC_ANOMALY:    { icon: "📊", label: "TRAFFIC" },
  SLOWDOWN:           { icon: "🐢", label: "SLOWDOWN" },
  TANKER_CLUSTER:     { icon: "🛢️", label: "CLUSTER" },
  NEWS_CORRELATION:   { icon: "📰", label: "NEWS INTEL" },
};

const SEV_STYLE = {
  CRITICAL: { color: "#ef4444", bg: "#ef444411" },
  HIGH:     { color: "#f97316", bg: "#f9731611" },
  MEDIUM:   { color: "#f59e0b", bg: "#f59e0b11" },
  LOW:      { color: "#22c55e", bg: "transparent" },
};

export function IntelFeed({ fullHeight = false, compact = false, className = "" }) {
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const esRef = useRef(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${API}/stream/events`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          setEvents((prev) => [ev, ...prev].slice(0, 200));
        } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  const filtered = filter === "ALL"
    ? events
    : events.filter((e) => e.severity === filter);

  return (
    <div className={`panel overflow-hidden flex flex-col h-full ${className}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-2">
        <div className="panel-label mb-0">// Live Intelligence Feed</div>
        <div className="flex-1" />
        {/* Filter buttons */}
        {["ALL", "CRITICAL", "HIGH", "MEDIUM"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="font-mono text-xs px-2 py-0.5 rounded border transition-colors"
            style={{
              borderColor: filter === f ? (SEV_STYLE[f]?.color || "#00d4ff") : "#0f2a40",
              color: filter === f ? (SEV_STYLE[f]?.color || "#00d4ff") : "#4a5568",
              background: filter === f ? (SEV_STYLE[f]?.bg || "#00d4ff11") : "transparent",
            }}
          >
            {f}
          </button>
        ))}
        <span className="font-mono text-xs text-dimtext">{filtered.length}</span>
      </div>

      {/* Event rows */}
      <div className="overflow-y-auto flex-1 flex flex-col gap-0.5">
        {filtered.length === 0 ? (
          <p className="text-xs text-dimtext italic">Monitoring…</p>
        ) : (
          filtered.map((ev, i) => {
            const meta = TYPE_META[ev.type] || { icon: "⚠️", label: ev.type };
            const sev = SEV_STYLE[ev.severity] || SEV_STYLE.LOW;
            return (
              <div
                key={i}
                className="flex items-start gap-2 px-2 py-1 rounded"
                style={{ background: sev.bg }}
              >
                <span className="text-sm shrink-0 mt-0.5">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-bold shrink-0" style={{ color: sev.color }}>
                      {ev.severity}
                    </span>
                    <span className="font-mono text-xs shrink-0" style={{ color: "#00d4ff", opacity: 0.7 }}>
                      {meta.label}
                    </span>
                    <span className="font-mono text-xs text-dimtext ml-auto shrink-0">
                      {ev.timestamp
                        ? formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true })
                        : ""}
                    </span>
                  </div>
                  <p className="text-xs text-dimtext leading-snug truncate">{ev.description}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
