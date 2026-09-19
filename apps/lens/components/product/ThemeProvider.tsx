"use client";

/**
 * ThemeProvider — client-only bootstrap for the theme store.
 * ─────────────────────────────────────────────────────────────────────
 * • Hydrates the persisted theme from localStorage on mount.
 * • Mirrors mode/textSize/density into classes on <html> so CSS rules
 *   in globals.css can react without every component knowing about it.
 * • Listens for OS appearance changes when mode = "system".
 */

import { useEffect } from "react";
import { resolveMode, useTheme } from "@/lib/theme";

const TEXT_SIZE_PX: Record<string, string> = {
  sm: "14px",
  md: "16px",
  lg: "17px",
  xl: "18px",
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useTheme((s) => s.mode);
  const textSize = useTheme((s) => s.textSize);
  const density = useTheme((s) => s.density);
  const reducedMotion = useTheme((s) => s.reducedMotion);
  const hydrate = useTheme((s) => s.hydrate);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Apply theme class + vars to <html>.
  useEffect(() => {
    const root = document.documentElement;
    const resolved = resolveMode(mode);
    root.classList.toggle("dark", resolved === "dark");
    root.dataset.density = density;
    root.style.fontSize = TEXT_SIZE_PX[textSize] ?? "16px";
    root.dataset.reducedMotion = reducedMotion ? "true" : "false";
  }, [mode, textSize, density, reducedMotion]);

  // Follow system changes only when the user selected "system".
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      document.documentElement.classList.toggle("dark", mql.matches);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  return <>{children}</>;
}
