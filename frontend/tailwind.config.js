/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#060a0f",
        surface:  "#071520",
        border:   "#0f2a40",
        primary:  "#00d4ff",
        dimtext:  "#94a3b8",
        bright:   "#e2e8f0",
        critical: "#ef4444",
        high:     "#f97316",
        medium:   "#f59e0b",
        low:      "#22c55e",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
}
