import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function useVesselStream() {
  const [vessels, setVessels] = useState([]);
  const esRef = useRef(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`${API}/stream/vessels`);
      esRef.current = es;
      es.onmessage = (e) => {
        try { setVessels(JSON.parse(e.data)); } catch {}
      };
      es.onerror = () => {
        es.close();
        setTimeout(connect, 5000);
      };
    }
    connect();
    return () => esRef.current?.close();
  }, []);

  return vessels;
}
