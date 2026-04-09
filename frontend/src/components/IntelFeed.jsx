import { formatDistanceToNow } from "date-fns";
import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const SEV_COLORS = {
  CRITICAL: "severity-critical",
  HIGH: "severity-high",
  MEDIUM: "severity-medium",
  LOW: "severity-low",
};

export function IntelFeed() {
  const [events, setEvents] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${API}/stream/events`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          setEvents((prev) => [ev, ...prev].slice(0, 100));
        } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  return (
    <div className="panel h-full overflow-hidden flex flex-col">
      <div className="panel-label">// Live Intelligence Feed</div>
      <div className="overflow-y-auto flex-1 flex flex-col gap-1">
        {events.length === 0
          ? <p className="text-xs text-dimtext italic">Monitoring…</p>
          : events.map((ev, i) => (
            <div key={i} className="flex gap-2 text-xs py-0.5 border-b border-border last:border-0">
              <span className={`font-mono font-bold w-16 shrink-0 ${SEV_COLORS[ev.severity] || "text-dimtext"}`}>
                {ev.severity}
              </span>
              <span className="font-mono text-primary w-28 shrink-0 truncate">{ev.type}</span>
              <span className="text-dimtext flex-1 truncate">{ev.description}</span>
              <span className="font-mono text-dimtext shrink-0">
                {ev.timestamp ? formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true }) : ""}
              </span>
            </div>
          ))
        }
      </div>
    </div>
  );
}
