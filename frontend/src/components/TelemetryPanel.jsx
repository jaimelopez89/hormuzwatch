// frontend/src/components/TelemetryPanel.jsx
import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function Metric({ label, value, unit, color = "#00d4ff" }) {
  return (
    <div className="flex flex-col items-center px-2 py-2 rounded"
      style={{ background: "#040b14", border: "1px solid #0f2a40" }}>
      <div className="font-mono text-base font-bold" style={{ color }}>{value ?? "—"}</div>
      <div className="font-mono text-xs mt-0.5" style={{ color: "#4a5568" }}>{unit}</div>
      <div style={{ fontFamily: "monospace", fontSize: 9, color: "#374151", marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function TelemetryPanel() {
  const [t, setT] = useState(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`${API}/api/telemetry`).catch(() => null);
      if (res?.ok) setT(await res.json());
    };
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const p = t?.pipeline;
  const src = t?.sources;

  return (
    <div className="panel">
      <div className="panel-label">// Pipeline Telemetry</div>
      <p className="text-xs text-dimtext mb-3">Flink → Kafka → Backend (live)</p>
      {t ? (
        <div className="grid grid-cols-3 gap-2">
          <Metric label="VESSELS"    value={p?.vessels_tracked}  unit="live"  color="#00d4ff" />
          <Metric label="EVENTS"     value={p?.events_buffered}  unit="buffered" color="#f97316" />
          <Metric label="HEATMAP"    value={p?.heatmap_cells}    unit="cells" color="#06b6d4" />
          <Metric label="FLEET"      value={p?.fleet_edges}      unit="edges" color="#a78bfa" />
          <Metric label="FORECASTS"  value={p?.predictions}      unit="paths" color="#22c55e" />
          <Metric label="AIS AGE"    value={src?.aisstream?.age_s != null ? `${src.aisstream.age_s}s` : "—"} unit="staleness" color="#f59e0b" />
        </div>
      ) : (
        <p className="text-xs italic" style={{ color: "#64748b" }}>Loading…</p>
      )}
    </div>
  );
}
