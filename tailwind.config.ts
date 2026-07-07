import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Design system FABLE 5 — dark, sóbrio, financeiro
        bg: "#0B0D11",          // fundo global
        surface: "#12151B",     // cards / painéis
        raised: "#181C24",      // hover / elementos elevados
        border: "#232936",      // bordas sutis
        "border-strong": "#2F3745",
        fg: "#E9ECF1",          // texto principal
        muted: "#8B93A1",       // texto secundário
        faint: "#5B6372",       // texto terciário / labels
        accent: {
          DEFAULT: "#3ECF8E",   // verde financeiro (ação primária)
          hover: "#34B87D",
          soft: "rgba(62,207,142,0.12)",
        },
        warn: { DEFAULT: "#F5B94E", soft: "rgba(245,185,78,0.12)" },
        danger: { DEFAULT: "#F0645C", soft: "rgba(240,100,92,0.12)" },
        info: { DEFAULT: "#6E9BF5", soft: "rgba(110,155,245,0.12)" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 1px 2px rgba(0,0,0,0.4)",
        pop: "0 8px 30px rgba(0,0,0,0.55)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: { "fade-up": "fade-up .25s ease-out both" },
    },
  },
  plugins: [],
};
export default config;
