import { useState, useEffect } from "react";
import { StatusBadge } from "./StatusBadge";
import { ShareButton } from "./ShareButton";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function Header() {
  const [risk, setRisk] = useState({ score: 5, level: "LOW" });
  const [stats, setStats] = useState({ vessels: 0, tankers: 0, critical: 0 });
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    async function fetchRisk() {
      try {
        const res = await fetch(`${API}/api/risk`);
        if (res.ok) setRisk(await res.json());
      } catch {}
    }
    async function fetchStats() {
      try {
        const res = await fetch(`${API}/api/stats`);
        if (res.ok) setStats(await res.json());
      } catch {}
    }
    fetchRisk();
    fetchStats();
    const ri = setInterval(fetchRisk, 10_000);
    const si = setInterval(fetchStats, 15_000);
    const ti = setInterval(() => setTime(new Date()), 1000);
    return () => { clearInterval(ri); clearInterval(si); clearInterval(ti); };
  }, []);

  return (
    <header
      className="flex items-center gap-4 px-4 py-2 border-b"
      style={{ background: "#030810", borderColor: "#0f2a40" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono font-bold text-sm tracking-widest" style={{ color: "#00d4ff" }}>
          ⚓ HORMUZWATCH
        </span>
        <div className="live-dot" />
        <span className="font-mono text-xs tracking-widest" style={{ color: "#00d4ff", opacity: 0.7 }}>
          LIVE
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-border shrink-0" />

      {/* Is Hormuz Open badge — the headline */}
      <StatusBadge risk={risk} />

      {/* Divider */}
      <div className="w-px h-6 bg-border shrink-0" />

      {/* Threat score bar */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-dimtext tracking-widest">RISK</span>
        <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: "#0f2a40" }}>
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${risk.score}%`,
              background: risk.level === "CRITICAL" ? "#ef4444"
                : risk.level === "HIGH" ? "#f97316"
                : risk.level === "ELEVATED" ? "#f59e0b"
                : "#22c55e",
            }}
          />
        </div>
        <span className="font-mono text-xs tabular-nums text-dimtext">{risk.score}/100</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Vessel / tanker counts */}
      <div className="font-mono text-xs text-dimtext flex items-center gap-3">
        <span><span style={{ color: "#00d4ff" }}>{stats.vessels}</span> vessels</span>
        <span><span style={{ color: "#f97316" }}>{stats.tankers}</span> tankers</span>
        {stats.critical > 0 && (
          <span><span style={{ color: "#ef4444" }}>{stats.critical}</span> critical</span>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-border" />

      {/* RSS link */}
      <a
        href={`${API}/rss`} target="_blank" rel="noopener noreferrer"
        className="font-mono text-xs"
        style={{ color: "#f97316", opacity: 0.7 }}
        title="Subscribe to intelligence events via RSS"
      >
        RSS
      </a>

      {/* Divider */}
      <div className="w-px h-6 bg-border" />

      {/* Share */}
      <ShareButton compact />

      {/* UTC clock */}
      <div className="font-mono text-xs text-dimtext tabular-nums">
        {time.toUTCString().slice(5, 25)} UTC
      </div>
    </header>
  );
}
