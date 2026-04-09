import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function useBriefingStream() {
  const [briefing, setBriefing] = useState(null);
  const esRef = useRef(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${API}/stream/briefing`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data) setBriefing(data);
        } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  return briefing;
}
