import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        abyss: {
          bg: "#050810",
          panel: "#0a1120",
          edge: "#1b2a44",
          neon: "#22d3ee",
          mint: "#34d399",
          blood: "#f43f5e",
          amber: "#fbbf24",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
