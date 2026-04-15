import { useState } from "react";
import { BriefingPanel } from "./BriefingPanel";
import { MarketPanel } from "./MarketPanel";
import { WeatherWidget } from "./WeatherWidget";

const TABS = [
  { id: "briefing", label: "BRIEFING" },
  { id: "market",   label: "MARKET"   },
  { id: "weather",  label: "WEATHER"  },
];

export function Sidebar({ briefing, market, inline = false }) {
  const [active, setActive] = useState("briefing");

  if (inline) {
    // Inline mode — just show both stacked in a column, no tabs
    return (
      <div className="flex flex-col gap-3">
        <BriefingPanel briefing={briefing} />
        <MarketPanel market={market} />
      </div>
    );
  }

  return (
    <div
      className="w-full flex flex-col overflow-hidden"
      style={{ background: "#040b14" }}
    >
      {/* Tab bar */}
      <div className="flex border-b shrink-0" style={{ borderColor: "#0f2a40" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className="flex-1 font-mono text-xs py-2 tracking-widest transition-colors"
            style={{
              color: active === t.id ? "#00d4ff" : "#4a5568",
              borderBottom: active === t.id ? "2px solid #00d4ff" : "2px solid transparent",
              background: active === t.id ? "#00d4ff0a" : "transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-2">
        {active === "briefing" && <BriefingPanel briefing={briefing} />}
        {active === "market"   && <MarketPanel market={market} />}
        {active === "weather"  && <WeatherWidget />}
      </div>
    </div>
  );
}
