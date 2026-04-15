import { useState, useEffect, useRef } from "react";
import { ShareButton } from "./ShareButton";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function Header() {
  const [stats, setStats]   = useState({ vessels: 0, tankers: 0, critical: 0 });
  const [time, setTime]     = useState(new Date());
  const [ticks, setTicks]   = useState([]);  // rolling intel events for ticker
  const esRef = useRef(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`${API}/api/stats`);
        if (res.ok) setStats(await res.json());
      } catch {}
    }
    fetchStats();
    const si = setInterval(fetchStats, 15_000);
    const ti = setInterval(() => setTime(new Date()), 1000);

    function connectTicker() {
      const es = new EventSource(`${API}/stream/events`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.type && d.description) {
            const label = d.type.replace(/_/g, " ");
            const text  = typeof d.description === "string"
              ? d.description.slice(0, 120)
              : label;
            setTicks(prev => [`[${label}] ${text}`, ...prev].slice(0, 30));
          }
        } catch {}
      };
      es.onerror = () => { es.close(); setTimeout(connectTicker, 5000); };
    }
    connectTicker();

    return () => { clearInterval(si); clearInterval(ti); esRef.current?.close(); };
  }, []);

  const tickerText = ticks.length > 0
    ? ticks.join("   ·   ")
    : "MONITORING ACTIVE — Strait of Hormuz intelligence feed   ·   AIS tracking live   ·   No events queued";

  return (
    <header
      className="flex items-center gap-0 border-b shrink-0"
      style={{ background: "#030810", borderColor: "#0f2a40", height: 36 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 shrink-0 border-r" style={{ borderColor: "#0f2a40", height: "100%" }}>
        <span className="font-mono font-bold text-sm tracking-widest" style={{ color: "#00d4ff" }}>
          ⚓ HORMUZWATCH
        </span>
        <div className="live-dot" />
        <span className="font-mono text-xs tracking-widest" style={{ color: "#00d4ff", opacity: 0.6 }}>
          LIVE
        </span>
      </div>

      {/* Scrolling intel ticker */}
      <div className="flex-1 overflow-hidden relative" style={{ height: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: "100%",
            whiteSpace: "nowrap",
            animation: "ticker-scroll 60s linear infinite",
            willChange: "transform",
          }}
        >
          <span className="font-mono text-xs px-4" style={{ color: "#4a5568", letterSpacing: "0.05em" }}>
            {tickerText}
            &nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp;
            {tickerText}
          </span>
        </div>
        {/* Fade edges */}
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 48,
          background: "linear-gradient(to right, #030810, transparent)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: 48,
          background: "linear-gradient(to left, #030810, transparent)",
          pointerEvents: "none",
        }} />
      </div>

      {/* Right: vessel counts + utilities */}
      <div className="flex items-center gap-3 px-4 shrink-0 border-l" style={{ borderColor: "#0f2a40", height: "100%" }}>
        <span className="font-mono text-xs" style={{ color: "#94a3b8" }}>
          <span style={{ color: "#00d4ff", fontWeight: 700 }}>{stats.vessels}</span> vessels
        </span>
        <span className="font-mono text-xs" style={{ color: "#94a3b8" }}>
          <span style={{ color: "#f97316", fontWeight: 700 }}>{stats.tankers}</span> tankers
        </span>
        {stats.critical > 0 && (
          <span className="font-mono text-xs animate-pulse" style={{ color: "#ef4444", fontWeight: 700 }}>
            ⚠ {stats.critical} CRITICAL
          </span>
        )}

        <div className="w-px h-4" style={{ background: "#0f2a40" }} />

        <a
          href={`${API}/rss`} target="_blank" rel="noopener noreferrer"
          className="font-mono text-xs"
          style={{ color: "#f97316", opacity: 0.7 }}
          title="Subscribe via RSS"
        >
          RSS
        </a>

        <div className="w-px h-4" style={{ background: "#0f2a40" }} />

        <ShareButton compact />

        <div className="w-px h-4" style={{ background: "#0f2a40" }} />

        <div className="font-mono text-xs tabular-nums" style={{ color: "#4a5568" }}>
          {time.toUTCString().slice(5, 25)} UTC
        </div>
      </div>
    </header>
  );
}
