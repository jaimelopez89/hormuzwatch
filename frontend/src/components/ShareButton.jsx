import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function buildShareText(status) {
  const open = { YES: "OPEN ✅", NO: "DISRUPTED 🚨", UNCERTAIN: "UNCERTAIN ⚠️" }[status?.is_open] || "UNKNOWN";
  const risk = status?.risk_level || "UNKNOWN";
  const vessels = status?.active_vessels || 0;
  const poly = status?.polymarket_yes_pct ? ` | Markets: ${status.polymarket_yes_pct}% YES` : "";
  const pw = status?.portwatch_pct ? ` | Traffic: ${status.portwatch_pct}% of normal` : "";

  return `IS THE STRAIT OF HORMUZ OPEN? ${open}\n\nRisk: ${risk} | ${vessels} vessels tracked${pw}${poly}\n\nLive intelligence at https://hormuzwatch.io`;
}

export function ShareButton({ status }) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const text = buildShareText(status);
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;

  function copyLink() {
    navigator.clipboard?.writeText("https://hormuzwatch.io").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    setMenuOpen(false);
  }

  function shareNative() {
    if (navigator.share) {
      navigator.share({
        title: "Is the Strait of Hormuz Open?",
        text: text,
        url: "https://hormuzwatch.io",
      });
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(m => !m)}
        className="flex items-center gap-2 font-mono text-xs px-3 py-1.5 rounded border transition-colors"
        style={{
          borderColor: "#00d4ff44",
          color: "#00d4ff",
          background: menuOpen ? "#00d4ff11" : "transparent",
        }}
      >
        <span>↗</span>
        <span>SHARE</span>
      </button>

      {menuOpen && (
        <div
          className="absolute right-0 top-8 rounded z-50 flex flex-col overflow-hidden"
          style={{ background: "#040c18", border: "1px solid #0f2a40", minWidth: 180, boxShadow: "0 8px 24px #00000066" }}
        >
          <a
            href={tweetUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-xs font-mono text-dimtext hover:text-bright transition-colors"
            style={{ borderBottom: "1px solid #0f2a40" }}
            onClick={() => setMenuOpen(false)}
          >
            𝕏 Share on X / Twitter
          </a>
          <button
            onClick={copyLink}
            className="flex items-center gap-2 px-3 py-2 text-xs font-mono text-dimtext hover:text-bright transition-colors text-left"
            style={{ borderBottom: "1px solid #0f2a40" }}
          >
            {copied ? "✓ Copied!" : "🔗 Copy link"}
          </button>
          <a
            href={`${API}/embed`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-xs font-mono text-dimtext hover:text-bright transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            {"<>"} Embed widget
          </a>
          {navigator.share && (
            <button
              onClick={shareNative}
              className="flex items-center gap-2 px-3 py-2 text-xs font-mono text-dimtext hover:text-bright transition-colors text-left"
            >
              ↑ Share via device
            </button>
          )}
        </div>
      )}
    </div>
  );
}
