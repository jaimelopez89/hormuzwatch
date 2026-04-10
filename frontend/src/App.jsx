import { useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { HeroStatus } from "./components/HeroStatus";
import { Map } from "./components/Map";
import { Sidebar } from "./components/Sidebar";
import { IntelFeed } from "./components/IntelFeed";
import { VesselDetail } from "./components/VesselDetail";
import { ToastAlerts } from "./components/ToastAlerts";
import { TransitChart } from "./components/TransitChart";
import { PolymarketWidget } from "./components/PolymarketWidget";
import { ShareButton } from "./components/ShareButton";
import { useVesselStream } from "./hooks/useVesselStream";
import { useBriefingStream } from "./hooks/useBriefingStream";
import { useMarketStream } from "./hooks/useMarketStream";
import { useBrowserAlerts } from "./hooks/useBrowserAlerts";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function App() {
  const vessels = useVesselStream();
  const briefing = useBriefingStream();
  const market = useMarketStream();
  const [selectedVessel, setSelectedVessel] = useState(null);
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState("map"); // "map" | "intel" | "data"

  useBrowserAlerts(true); // request permission + fire notifications for CRITICAL events

  useEffect(() => {
    fetch(`${API}/api/status`).then(r => r.ok ? r.json() : null).then(d => d && setStatus(d)).catch(() => {});
    const i = setInterval(() => {
      fetch(`${API}/api/status`).then(r => r.ok ? r.json() : null).then(d => d && setStatus(d)).catch(() => {});
    }, 15_000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "#030810" }}>
      <Header />
      <ToastAlerts />

      {/* Scrollable main content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">

        {/* Hero — IS HORMUZ OPEN? */}
        <HeroStatus />

        {/* Share button row */}
        <div className="flex items-center justify-end px-4 pb-2">
          <ShareButton status={status} />
        </div>

        {/* Navigation tabs for main views */}
        <div
          className="flex border-b sticky top-0 z-30"
          style={{ borderColor: "#0f2a40", background: "#030810" }}
        >
          {[
            { id: "map",   label: "LIVE MAP" },
            { id: "intel", label: "INTEL FEED" },
            { id: "data",  label: "DATA & MARKETS" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 font-mono text-xs py-2.5 tracking-widest transition-colors"
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

        {/* MAP TAB */}
        {tab === "map" && (
          <div className="flex" style={{ height: "calc(100vh - 280px)", minHeight: 400 }}>
            {/* Map */}
            <div className="flex-1 relative">
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
            <Sidebar briefing={briefing} market={market} />
          </div>
        )}

        {/* INTEL TAB */}
        {tab === "intel" && (
          <div className="p-3" style={{ minHeight: "calc(100vh - 280px)" }}>
            <IntelFeed fullHeight />
          </div>
        )}

        {/* DATA TAB */}
        {tab === "data" && (
          <div className="flex flex-col gap-3 p-3">
            <TransitChart />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <PolymarketWidget />
              <Sidebar briefing={briefing} market={market} inline />
            </div>
          </div>
        )}

        {/* Transit chart always visible in map view (below map) */}
        {tab === "map" && (
          <div className="p-3">
            <TransitChart />
          </div>
        )}

        {/* Bottom intel strip in map/data view */}
        {tab !== "intel" && (
          <div className="p-3 pt-0" style={{ height: 180 }}>
            <IntelFeed compact />
          </div>
        )}
      </div>
    </div>
  );
}
