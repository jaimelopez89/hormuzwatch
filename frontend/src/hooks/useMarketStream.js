import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function useMarketStream() {
  const [market, setMarket] = useState({});

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`${API}/api/market`);
        if (res.ok) setMarket(await res.json());
      } catch {}
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, []);

  return market;
}
