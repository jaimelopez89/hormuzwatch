// frontend/src/components/StreamingBriefing.jsx
import { useEffect, useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function StreamingBriefing() {
  const [headline, setHeadline] = useState("");
  const [text, setText] = useState("");
  const [latencyMs, setLatencyMs] = useState(null);
  const [live, setLive] = useState(false);
  const esRef = useRef(null);
  const reconnectRef = useRef(null);

  useEffect(() => {
    function connect() {
      esRef.current?.close();
      const es = new EventSource(`${API}/stream/briefing-tokens`);
      esRef.current = es;

      es.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "meta") {
            setHeadline(msg.headline || "");
            setLatencyMs(msg.duration_ms || null);
            setText("");
            setLive(true);
          } else if (msg.type === "token") {
            setText(prev => prev + msg.token);
          } else if (msg.type === "done") {
            setLive(false);
          }
        } catch {}
      };

      es.onerror = () => {
        setLive(false);
        clearTimeout(reconnectRef.current);
        reconnectRef.current = setTimeout(connect, 5_000);
      };
    }
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      esRef.current?.close();
    };
  }, []);

  return (
    <div className="panel flex flex-col" style={{ minHeight: 160 }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="panel-label">// AI Briefing — Live Stream</div>
        {live && <span className="font-mono text-xs animate-pulse" style={{ color: "#a78bfa" }}>GENERATING</span>}
      </div>
      {headline && (
        <div className="font-mono text-xs font-bold mb-1" style={{ color: "#e2e8f0" }}>{headline}</div>
      )}
      <div className="flex-1 font-mono text-xs leading-relaxed" style={{ color: "#94a3b8", whiteSpace: "pre-wrap" }}>
        {text || <span className="italic" style={{ color: "#64748b" }}>Waiting for next synthesis cycle…</span>}
        {live && <span className="inline-block w-1.5 h-3 ml-0.5 align-middle animate-pulse" style={{ background: "#a78bfa" }} />}
      </div>
      {latencyMs !== null && (
        <div className="mt-2 font-mono text-xs" style={{ color: "#374151" }}>
          generation: {latencyMs.toLocaleString()}ms
        </div>
      )}
    </div>
  );
}
