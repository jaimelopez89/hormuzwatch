import { useState } from "react";
import { Header } from "./components/Header";
import { Map } from "./components/Map";
import { BriefingPanel } from "./components/BriefingPanel";
import { MarketPanel } from "./components/MarketPanel";
import { IntelFeed } from "./components/IntelFeed";
import { useVesselStream } from "./hooks/useVesselStream";
import { useBriefingStream } from "./hooks/useBriefingStream";
import { useMarketStream } from "./hooks/useMarketStream";

export default function App() {
  const vessels = useVesselStream();
  const briefing = useBriefingStream();
  const market = useMarketStream();
  const [selectedVessel, setSelectedVessel] = useState(null);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        {/* Map — center, takes most space */}
        <div className="flex-1 relative">
          <Map vessels={vessels} onVesselClick={setSelectedVessel} />
          {selectedVessel && (
            <div className="absolute bottom-4 left-4 panel w-64 z-10">
              <div className="panel-label">// Selected Vessel</div>
              <p className="text-xs text-bright font-semibold">{selectedVessel.name || "Unknown"}</p>
              <p className="text-xs text-dimtext font-mono">MMSI: {selectedVessel.mmsi}</p>
              <p className="text-xs text-dimtext font-mono">Speed: {selectedVessel.speed} kt</p>
              <button
                className="mt-2 text-xs text-dimtext hover:text-primary font-mono"
                onClick={() => setSelectedVessel(null)}
              >
                ✕ dismiss
              </button>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-80 flex flex-col gap-2 p-2 overflow-y-auto border-l border-border">
          <BriefingPanel briefing={briefing} />
          <MarketPanel market={market} />
        </div>
      </div>

      {/* Bottom intel feed */}
      <div className="h-32 border-t border-border p-2">
        <IntelFeed />
      </div>
    </div>
  );
}
