import { useState } from "react";
import { Header } from "./components/Header";
import { HeroStatus } from "./components/HeroStatus";
import { Map } from "./components/Map";
import { Sidebar } from "./components/Sidebar";
import { IntelFeed } from "./components/IntelFeed";
import { VesselDetail } from "./components/VesselDetail";
import { ToastAlerts } from "./components/ToastAlerts";
import { TransitChart } from "./components/TransitChart";
import { PolymarketWidget } from "./components/PolymarketWidget";
import { useVesselStream } from "./hooks/useVesselStream";
import { useBriefingStream } from "./hooks/useBriefingStream";
import { useMarketStream } from "./hooks/useMarketStream";
import { useBrowserAlerts } from "./hooks/useBrowserAlerts";

const TABS = [
  { id: "map",   label: "LIVE MAP" },
  { id: "intel", label: "INTEL FEED" },
  { id: "data",  label: "DATA & CHARTS" },
];

export default function App() {
  const vessels  = useVesselStream();
  const briefing = useBriefingStream();
  const market   = useMarketStream();
  const [selectedVessel, setSelectedVessel] = useState(null);
  const [tab, setTab] = useState("map");

  useBrowserAlerts(true);

  return (
    // Root: full-height flex column, nothing scrolls at this level
    <div className="flex flex-col" style={{ height: "100dvh", background: "#030810", overflow: "hidden" }}>
      <Header />
      <ToastAlerts />

      {/* Hero — compact single row */}
      <HeroStatus />

      {/* Tab bar — sticky */}
      <div className="flex shrink-0 border-b" style={{ borderColor: "#0f2a40" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex-1 font-mono text-xs py-2 tracking-widest transition-colors"
            style={{
              color: tab === t.id ? "#00d4ff" : "#4a5568",
              borderBottom: tab === t.id ? "2px solid #00d4ff" : "2px solid transparent",
              background: tab === t.id ? "#00d4ff06" : "transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Main content — takes all remaining space */}
      <div className="flex-1 overflow-hidden">

        {/* MAP TAB */}
        {tab === "map" && (
          <div className="flex h-full">
            {/* Map fills left */}
            <div className="flex-1 relative min-w-0">
              <Map vessels={vessels} onVesselClick={setSelectedVessel} />
              <VesselDetail vessel={selectedVessel} onClose={() => setSelectedVessel(null)} />
              {vessels.length > 0 && (
                <div
                  className="absolute top-3 left-3 font-mono text-xs px-2 py-1 rounded z-10"
                  style={{ background: "#060d1888", border: "1px solid #0f2a40", color: "#00d4ff" }}
                >
                  {vessels.length} vessels in AOR
                </div>
              )}
            </div>

            {/* Right sidebar */}
            <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: 300, borderLeft: "1px solid #0f2a40", background: "#040b14" }}>
              {/* Briefing + Market stacked, scrollable */}
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
                <Sidebar briefing={briefing} market={market} />
              </div>
              {/* Intel strip at bottom of sidebar */}
              <div style={{ height: 200, borderTop: "1px solid #0f2a40", flexShrink: 0 }}>
                <IntelFeed compact />
              </div>
            </div>
          </div>
        )}

        {/* INTEL TAB */}
        {tab === "intel" && (
          <div className="h-full p-3">
            <IntelFeed fullHeight />
          </div>
        )}

        {/* DATA TAB */}
        {tab === "data" && (
          <div className="h-full overflow-y-auto p-3 flex flex-col gap-3">
            <TransitChart />
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <PolymarketWidget />
              <div className="flex flex-col gap-3">
                <Sidebar briefing={briefing} market={market} inline />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
