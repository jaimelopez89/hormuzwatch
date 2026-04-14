import { useEffect, useRef, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const TYPE_ICONS = {
  DARK_AIS:          "📡",
  STS_RENDEZVOUS:    "🔄",
  SANCTIONS_HIT:     "🚨",
  MILITARY_PROXIMITY:"⚔️",
  TRAFFIC_ANOMALY:   "📊",
  SLOWDOWN:          "🐢",
  TANKER_CLUSTER:    "🛢️",
  NEWS_CORRELATION:  "📰",
};

const SEV_COLORS = {
  CRITICAL: { bg: "#1a0505", border: "#ef4444", text: "#ef4444" },
  HIGH:     { bg: "#1a0a05", border: "#f97316", text: "#f97316" },
};

export function ToastAlerts() {
  const [toasts, setToasts] = useState([]);
  const esRef = useRef(null);
  const idRef = useRef(0);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${API}/stream/events`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.severity !== "CRITICAL" && ev.severity !== "HIGH") return;

          const id = ++idRef.current;
          setToasts((prev) => [{ ...ev, _id: id }, ...prev].slice(0, 5));

          // Auto-dismiss after 8s (CRITICAL) or 5s (HIGH)
          const ttl = ev.severity === "CRITICAL" ? 8000 : 5000;
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t._id !== id));
          }, ttl);
        } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((ev) => {
        const c = SEV_COLORS[ev.severity] || SEV_COLORS.HIGH;
        const icon = TYPE_ICONS[ev.type] || "⚠️";
        return (
          <div
            key={ev._id}
            className="rounded px-3 py-2 text-xs font-mono animate-toast-in"
            style={{ background: c.bg, border: `1px solid ${c.border}`, boxShadow: `0 0 12px ${c.border}66` }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span>{icon}</span>
              <span className="font-bold tracking-widest" style={{ color: c.text }}>{ev.severity}</span>
              <span className="text-dimtext ml-auto">{ev.type?.replace(/_/g, " ")}</span>
              <button
                className="text-dimtext hover:text-bright ml-1"
                onClick={() => setToasts((p) => p.filter((t) => t._id !== ev._id))}
              >✕</button>
            </div>
            <p className="text-dimtext leading-relaxed">{ev.description}</p>
          </div>
        );
      })}
    </div>
  );
}
