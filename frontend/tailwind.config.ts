import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: [
          "var(--font-space-grotesk)",
          "Space Grotesk",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Noto Sans SC",
          "sans-serif"
        ],
        body: [
          "var(--font-space-grotesk)",
          "Space Grotesk",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Noto Sans SC",
          "sans-serif"
        ]
      },
      colors: {
        black: "#000000",
        white: "#FFFFFF",
        canvas: "var(--neo-canvas)",
        paper: "var(--neo-paper)",
        ink: "var(--neo-ink)",
        acid: "var(--neo-accent)",
        coral: "var(--neo-accent)",
        sky: "var(--neo-muted)",
        mint: "var(--neo-secondary)",
        danger: "var(--neo-danger)",
        accent: "var(--neo-accent)",
        secondary: "var(--neo-secondary)",
        muted: "var(--neo-muted)",
        "issue-blue": "var(--neo-issue-blue)"
      },
      boxShadow: {
        "neo-sm": "4px 4px 0 0 #000000",
        "neo-md": "8px 8px 0 0 #000000",
        "neo-lg": "12px 12px 0 0 #000000",
        "neo-xl": "16px 16px 0 0 #000000",
        brutal: "8px 8px 0 0 #000000",
        "brutal-sm": "4px 4px 0 0 #000000"
      },
      borderRadius: {
        brutal: "0px"
      },
      keyframes: {
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" }
        }
      },
      animation: {
        "spin-slow": "spin-slow 10s linear infinite"
      }
    }
  },
  plugins: []
};

export default config;
