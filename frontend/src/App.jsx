import { useState } from "react";
import { Header } from "./components/Header";
import { Map } from "./components/Map";
import { Sidebar } from "./components/Sidebar";
import { IntelFeed } from "./components/IntelFeed";
import { VesselDetail } from "./components/VesselDetail";
import { ToastAlerts } from "./components/ToastAlerts";
import { useVesselStream } from "./hooks/useVesselStream";
import { useBriefingStream } from "./hooks/useBriefingStream";
import { useMarketStream } from "./hooks/useMarketStream";

export default function App() {
  const vessels = useVesselStream();
  const briefing = useBriefingStream();
  const market = useMarketStream();
  const [selectedVessel, setSelectedVessel] = useState(null);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "#030810" }}>
      <Header />

      {/* Toast notifications — fixed overlay, outside layout flow */}
      <ToastAlerts />

      <div className="flex flex-1 overflow-hidden">
        {/* Map — center stage */}
        <div className="flex-1 relative">
          <Map vessels={vessels} onVesselClick={setSelectedVessel} />

          {/* Vessel detail overlay */}
          <VesselDetail
            vessel={selectedVessel}
            onClose={() => setSelectedVessel(null)}
          />

          {/* Live vessel count badge on map */}
          {vessels.length > 0 && (
            <div
              className="absolute top-3 left-3 font-mono text-xs px-2 py-1 rounded z-10"
              style={{ background: "#060d1888", border: "1px solid #0f2a40", color: "#00d4ff" }}
            >
              {vessels.length} vessels in AOR
            </div>
          )}
        </div>

        {/* Right sidebar — tabbed */}
        <Sidebar briefing={briefing} market={market} />
      </div>

      {/* Bottom intel feed — taller to show more events */}
      <div className="shrink-0 border-t" style={{ height: 160, borderColor: "#0f2a40" }}>
        <IntelFeed />
      </div>
    </div>
  );
}
