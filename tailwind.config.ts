import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Design system Cifra Cobranças — light, legível, financeiro (público +40)
        bg: "#F6F7F9",          // fundo global (cinza muito claro)
        surface: "#FFFFFF",     // cards / painéis (branco)
        raised: "#EEF1F4",      // hover / elementos elevados
        border: "#E1E5EA",      // bordas sutis
        "border-strong": "#C9D0D8",
        fg: "#1A1F28",          // texto principal (quase preto)
        muted: "#5A6472",       // texto secundário
        faint: "#8A94A3",       // texto terciário / labels
        accent: {
          DEFAULT: "#159A63",   // verde financeiro mais escuro (contraste em fundo branco)
          hover: "#0F7E50",
          soft: "rgba(21,154,99,0.10)",
        },
        warn: { DEFAULT: "#B8791A", soft: "rgba(184,121,26,0.10)" },
        danger: { DEFAULT: "#CE3A34", soft: "rgba(206,58,52,0.10)" },
        info: { DEFAULT: "#2563C9", soft: "rgba(37,99,201,0.10)" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.04)",
        pop: "0 10px 40px rgba(16,24,40,0.18)",
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
