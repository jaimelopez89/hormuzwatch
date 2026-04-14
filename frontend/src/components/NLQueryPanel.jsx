import { useState, useRef, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function NLQueryPanel() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const esRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  function submit(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    setStreaming(true);
    setHistory(h => [...h, { role: "user", text: q }, { role: "ai", text: "" }]);

    esRef.current?.close();
    const es = new EventSource(`${API}/api/query?q=${encodeURIComponent(q)}`);
    esRef.current = es;

    es.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.token) {
          setHistory(h => {
            const copy = [...h];
            copy[copy.length - 1] = { role: "ai", text: copy[copy.length - 1].text + msg.token };
            return copy;
          });
        } else if (msg.done || msg.error) {
          setStreaming(false);
          es.close();
        }
      } catch {}
    };
    es.onerror = () => { setStreaming(false); es.close(); };
  }

  return (
    <div className="panel flex flex-col" style={{ minHeight: 320 }}>
      <div className="panel-label">// Intelligence Query</div>
      <p className="text-xs text-dimtext mb-3">Ask about vessels, risk levels, or specific MMSIs.</p>

      <div className="flex-1 overflow-y-auto flex flex-col gap-2 mb-3" style={{ maxHeight: 240 }}>
        {history.length === 0 && (
          <p className="text-xs italic" style={{ color: "#64748b" }}>No queries yet.</p>
        )}
        {history.map((msg, i) => (
          <div
            key={i}
            className={`text-xs rounded px-3 py-2 ${msg.role === "user" ? "self-end" : "self-start"}`}
            style={{
              background: msg.role === "user" ? "#0c2340" : "#060e1a",
              border: `1px solid ${msg.role === "user" ? "#1e3a5f" : "#0f2a40"}`,
              color: msg.role === "user" ? "#00d4ff" : "#94a3b8",
              maxWidth: "88%", whiteSpace: "pre-wrap",
            }}
          >
            {msg.text}
            {msg.role === "ai" && streaming && i === history.length - 1 && (
              <span className="inline-block w-1.5 h-3 ml-0.5 align-middle animate-pulse" style={{ background: "#00d4ff" }} />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="What vessels are near Fujairah?"
          disabled={streaming}
          className="flex-1 font-mono text-xs px-3 py-2 rounded"
          style={{ background: "#040b14", border: "1px solid #0f2a40", color: "#e2e8f0", outline: "none" }}
        />
        <button
          type="submit"
          disabled={streaming || !question.trim()}
          className="font-mono text-xs px-4 py-2 rounded"
          style={{
            background: streaming ? "#0f2a40" : "#00d4ff15",
            border: "1px solid #00d4ff33",
            color: streaming ? "#374151" : "#00d4ff",
            cursor: streaming ? "not-allowed" : "pointer",
          }}
        >
          {streaming ? "…" : "ASK"}
        </button>
      </form>
    </div>
  );
}
