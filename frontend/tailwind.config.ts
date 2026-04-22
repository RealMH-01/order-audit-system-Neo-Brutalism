import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-space-grotesk)", "sans-serif"]
      },
      colors: {
        canvas: "var(--color-canvas)",
        ink: "var(--color-ink)",
        paper: "var(--color-paper)",
        acid: "var(--color-acid)",
        coral: "var(--color-coral)",
        sky: "var(--color-sky)",
        mint: "var(--color-mint)",
        danger: "var(--color-danger)"
      },
      boxShadow: {
        brutal: "8px 8px 0 0 var(--color-ink)",
        "brutal-sm": "4px 4px 0 0 var(--color-ink)"
      },
      borderRadius: {
        brutal: "1.25rem"
      }
    }
  },
  plugins: []
};

export default config;
