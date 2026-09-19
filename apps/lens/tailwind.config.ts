import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Inter", "sans-serif"],
        serif: ["ui-serif", "Georgia", "Cambria", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        // LENS runs cool and neutral so the signal colour is the only
        // thing competing for attention — which is the whole point of a
        // product whose core interaction is "look here".
        ink: {
          950: "#F7F9FA",
          900: "#EDF1F3",
          850: "#E3E9EC",
          800: "#D6DEE3",
          700: "#C2CCD4",
          600: "#97A5B0",
          500: "#6F7E8C",
          400: "#4E5C69",
          300: "#33414D",
          200: "#1B2733",
          100: "#0B1220",
        },
        // The aperture teal. Used for exactly one thing per screen.
        signal: {
          DEFAULT: "#00C2A8",
          deep: "#00897B",
          soft: "#7FE3D6",
        },
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(0, 194, 168, 0.28)",
        soft: "0 4px 24px -4px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.03)",
        lift: "0 8px 40px -8px rgba(0, 194, 168, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04)",
        card: "0 1px 3px rgba(0, 0, 0, 0.03), 0 6px 24px rgba(0, 0, 0, 0.04)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(0,194,168,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,194,168,0.05) 1px, transparent 1px)",
        "radial-fade":
          "radial-gradient(ellipse at top, rgba(0,194,168,0.10), transparent 50%), radial-gradient(ellipse at bottom right, rgba(11,18,32,0.05), transparent 50%)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        floaty: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        breathe: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.6" },
          "50%": { transform: "scale(1.05)", opacity: "1" },
        },
      },
      animation: {
        shimmer: "shimmer 2.5s linear infinite",
        floaty: "floaty 6s ease-in-out infinite",
        "fade-up": "fade-up 0.6s ease-out forwards",
        "scale-in": "scale-in 0.5s ease-out forwards",
        breathe: "breathe 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
