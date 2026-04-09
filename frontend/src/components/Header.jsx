import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const LEVEL_COLORS = {
  CRITICAL: "text-critical",
  HIGH: "text-high",
  ELEVATED: "text-medium",
  LOW: "text-low",
};

const LEVEL_BAR_COLORS = {
  CRITICAL: "bg-critical",
  HIGH: "bg-high",
  ELEVATED: "bg-medium",
  LOW: "bg-low",
};

export function Header() {
  const [risk, setRisk] = useState({ score: 5, level: "LOW" });
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    async function fetchRisk() {
      try {
        const res = await fetch(`${API}/api/risk`);
        if (res.ok) setRisk(await res.json());
      } catch {}
    }
    fetchRisk();
    const ri = setInterval(fetchRisk, 10_000);
    const ti = setInterval(() => setTime(new Date()), 1000);
    return () => { clearInterval(ri); clearInterval(ti); };
  }, []);

  const barColor = LEVEL_BAR_COLORS[risk.level] || "bg-low";
  const textColor = LEVEL_COLORS[risk.level] || "text-low";

  return (
    <header className="flex items-center gap-4 px-4 py-2 border-b border-border bg-surface">
      <div className="flex items-center gap-2">
        <span className="text-primary font-mono font-bold text-sm tracking-widest">⚓ HORMUZWATCH</span>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="live-dot" />
        <span className="font-mono text-xs text-primary tracking-widest">LIVE</span>
      </div>

      <div className="flex items-center gap-2 ml-4">
        <span className="font-mono text-xs text-dimtext">THREAT</span>
        <div className="w-32 h-2 bg-border rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${barColor}`}
            style={{ width: `${risk.score}%` }}
          />
        </div>
        <span className={`font-mono text-xs font-bold ${textColor}`}>
          {risk.level} {risk.score}/100
        </span>
      </div>

      <div className="ml-auto font-mono text-xs text-dimtext">
        {time.toUTCString().slice(17, 25)} UTC
      </div>
    </header>
  );
}
