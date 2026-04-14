import { useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

/**
 * Hook that requests notification permission and fires browser notifications
 * for CRITICAL intelligence events.
 */
export function useBrowserAlerts(enabled = true) {
  const permRef = useRef(null);
  const lastSeenRef = useRef(0);
  const esRef = useRef(null);

  useEffect(() => {
    if (!enabled || !("Notification" in window)) return;

    // Request permission
    if (Notification.permission === "default") {
      Notification.requestPermission().then(p => { permRef.current = p; });
    } else {
      permRef.current = Notification.permission;
    }

    function connect() {
      const es = new EventSource(`${API}/stream/events`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.severity !== "CRITICAL") return;
          if (permRef.current !== "granted") return;

          const n = new Notification("🚨 HormuzWatch Critical Alert", {
            body: ev.description?.slice(0, 120) || ev.type,
            icon: "/favicon.ico",
            tag: ev.type + ev.mmsi, // deduplicate same vessel
            requireInteraction: true,
          });
          n.onclick = () => { window.focus(); n.close(); };
        } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();
    return () => esRef.current?.close();
  }, [enabled]);
}
