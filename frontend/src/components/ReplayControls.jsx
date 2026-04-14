// frontend/src/components/ReplayControls.jsx
import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const SPEEDS = [1, 5, 10, 20];

export function ReplayControls() {
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [speed, setSpeed] = useState(10);
  const [status, setStatus] = useState("idle");

  const statusColor = { idle: "#64748b", running: "#22c55e", stopped: "#f59e0b" }[status] || "#64748b";

  return (
    <div className="panel">
      <div className="panel-label">// AIS Replay</div>
      <p className="text-xs text-dimtext mb-3">Replay recorded vessel positions at compressed time.</p>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs" style={{ color: "#64748b", minWidth: 44 }}>DATE</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            disabled={status === "running"}
            className="font-mono text-xs px-2 py-1 rounded"
            style={{ background: "#040b14", border: "1px solid #0f2a40", color: "#e2e8f0", outline: "none" }}
          />
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-xs" style={{ color: "#64748b", minWidth: 44 }}>SPEED</span>
          <div className="flex gap-1">
            {SPEEDS.map(s => (
              <button key={s} onClick={() => setSpeed(s)} disabled={status === "running"}
                className="font-mono text-xs px-2.5 py-1 rounded"
                style={{
                  background: speed === s ? "#00d4ff22" : "#040b14",
                  border: `1px solid ${speed === s ? "#00d4ff55" : "#0f2a40"}`,
                  color: speed === s ? "#00d4ff" : "#64748b",
                  cursor: status === "running" ? "not-allowed" : "pointer",
                }}
              >{s}×</button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-xs" style={{ color: "#64748b", minWidth: 44 }}>STATUS</span>
          <span className="font-mono text-xs font-bold" style={{ color: statusColor }}>{status.toUpperCase()}</span>
        </div>

        <div className="flex gap-2 mt-1">
          <button
            onClick={async () => {
              const r = await fetch(
                `${API}/api/replay/start?date=${encodeURIComponent(date)}&speed=${speed}`,
                { method: "POST" }
              ).catch(() => null);
              if (r?.ok) setStatus("running");
            }}
            disabled={status === "running"}
            className="font-mono text-xs px-4 py-1.5 rounded"
            style={{ background: "#22c55e18", border: "1px solid #22c55e44", color: status === "running" ? "#374151" : "#22c55e", cursor: status === "running" ? "not-allowed" : "pointer" }}
          >PLAY</button>
          <button
            onClick={async () => {
              await fetch(`${API}/api/replay/stop`, { method: "POST" }).catch(() => null);
              setStatus("stopped");
            }}
            disabled={status !== "running"}
            className="font-mono text-xs px-4 py-1.5 rounded"
            style={{ background: "#f59e0b18", border: "1px solid #f59e0b44", color: status !== "running" ? "#374151" : "#f59e0b", cursor: status !== "running" ? "not-allowed" : "pointer" }}
          >STOP</button>
        </div>
      </div>
    </div>
  );
}
