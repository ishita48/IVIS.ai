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
        // LENS runs warm and neutral so the signal colour is the only
        // thing competing for attention — which is the whole point of a
        // product whose core interaction is "look here".
        ink: {
          950: "#FAF8F6",
          900: "#F2EBE5",
          850: "#E8DDD3",
          800: "#DACAB9",
          700: "#C2AB97",
          600: "#9C8570",
          500: "#7A6656",
          400: "#5C4C40",
          300: "#4A3F3C",
          200: "#332A26",
          100: "#241C19",
        },
        // The aperture peach. Used for exactly one thing per screen.
        signal: {
          DEFAULT: "#E06646",
          deep: "#B03D21",
          soft: "#EFB4A3",
        },
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(224, 102, 70, 0.28)",
        soft: "0 4px 24px -4px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.03)",
        lift: "0 8px 40px -8px rgba(224, 102, 70, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04)",
        card: "0 1px 3px rgba(0, 0, 0, 0.03), 0 6px 24px rgba(0, 0, 0, 0.04)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(224,102,70,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(224,102,70,0.05) 1px, transparent 1px)",
        "radial-fade":
          "radial-gradient(ellipse at top, rgba(224,102,70,0.10), transparent 50%), radial-gradient(ellipse at bottom right, rgba(11,18,32,0.05), transparent 50%)",
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
