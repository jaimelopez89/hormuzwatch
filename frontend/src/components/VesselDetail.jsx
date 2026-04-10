/**
 * VesselDetail — expanded vessel info panel displayed when a vessel is clicked on the map.
 */

const SHIP_TYPES = {
  0:  "Unknown", 20: "WIG", 30: "Fishing", 31: "Towing", 32: "Towing (large)",
  35: "Military", 36: "Law Enforcement", 37: "Pleasure Craft",
  40: "High Speed", 50: "Pilot", 51: "SAR", 52: "Tug", 53: "Port Tender",
  55: "Law Enforcement", 60: "Passenger", 69: "Passenger",
  70: "Cargo", 71: "Cargo", 72: "Cargo", 79: "Cargo",
  80: "Tanker", 81: "Tanker", 82: "Tanker", 83: "Tanker",
  84: "LNG Tanker", 85: "LNG Tanker", 89: "Tanker",
  90: "Other",
};

const NAV_STATUSES = {
  0: "Under way (engine)", 1: "At anchor", 2: "Not under command",
  3: "Restricted maneuverability", 4: "Constrained by draught",
  5: "Moored", 6: "Aground", 7: "Engaged in fishing",
  8: "Under way (sailing)", 15: "Not defined",
};

const SANCTIONED_MMSIS = new Set([
  271000835, 271000836, 271000837,
  422023900, 422030700, 422060300, 422100600, 422112200, 422134400,
  422301600, 422310000, 422316000,
  657570200, 657570300, 657570400,
  511101390, 511101394, 538007800, 538008900, 577305000,
  352002785, 636091798,
]);

function Row({ label, value, highlight }) {
  return (
    <div className="flex justify-between items-baseline gap-2 py-0.5 border-b border-border last:border-0">
      <span className="text-dimtext text-xs shrink-0">{label}</span>
      <span className={`font-mono text-xs text-right ${highlight || "text-bright"}`}>{value}</span>
    </div>
  );
}

export function VesselDetail({ vessel, onClose }) {
  if (!vessel) return null;

  const mmsi = parseInt(vessel.mmsi, 10);
  const sanctioned = SANCTIONED_MMSIS.has(mmsi);
  const shipTypeName = SHIP_TYPES[vessel.shipType] || SHIP_TYPES[Math.floor((vessel.shipType || 0) / 10) * 10] || "Unknown";
  const navStatus = NAV_STATUSES[vessel.navStatus] || NAV_STATUSES[15];
  const isMilitary = vessel.shipType === 35 || vessel.shipType === 36;

  return (
    <div
      className="absolute bottom-4 left-4 z-20 rounded"
      style={{
        background: "#060d18",
        border: `1px solid ${sanctioned ? "#ef4444" : isMilitary ? "#f97316" : "#0f2a40"}`,
        boxShadow: sanctioned ? "0 0 20px #ef444444" : "0 0 12px #00000066",
        width: 280,
        padding: 14,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-mono text-xs text-dimtext tracking-widest mb-0.5">// VESSEL DETAIL</div>
          <div className="font-bold text-sm text-bright leading-tight">
            {vessel.name || "UNKNOWN"}
          </div>
        </div>
        <button
          className="text-dimtext hover:text-bright font-mono text-xs ml-2"
          onClick={onClose}
        >✕</button>
      </div>

      {/* Sanctions warning */}
      {sanctioned && (
        <div className="mb-2 px-2 py-1 rounded text-xs font-mono font-bold text-critical"
          style={{ background: "#2a0505", border: "1px solid #ef4444" }}>
          ⚠ OFAC/EU SANCTIONED VESSEL
        </div>
      )}
      {isMilitary && !sanctioned && (
        <div className="mb-2 px-2 py-1 rounded text-xs font-mono font-bold text-high"
          style={{ background: "#1a0a05", border: "1px solid #f97316" }}>
          ⚔ MILITARY / LAW ENFORCEMENT
        </div>
      )}

      {/* Data rows */}
      <div className="flex flex-col">
        <Row label="MMSI" value={vessel.mmsi} />
        <Row label="Type" value={shipTypeName} />
        <Row label="Flag" value={vessel.flag || "—"} />
        <Row label="Status" value={navStatus} />
        <Row label="Speed" value={`${(vessel.speed || 0).toFixed(1)} kt`} />
        <Row label="Course" value={`${vessel.course || 0}°`} />
        <Row label="Heading" value={vessel.heading === 511 || !vessel.heading ? "—" : `${vessel.heading}°`} />
        <Row label="Position" value={`${(vessel.lat || 0).toFixed(4)}°N, ${(vessel.lon || 0).toFixed(4)}°E`} />
      </div>

      {/* Track button */}
      <button
        className="mt-3 w-full text-xs font-mono py-1 rounded border border-primary text-primary hover:bg-primary hover:text-bg transition-colors"
        onClick={() => {}}
      >
        TRACK THIS VESSEL
      </button>
    </div>
  );
}
