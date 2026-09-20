"use client";

/**
 * ThemeToggle — a small pill switch bound to the real theme store
 * (lib/theme.ts). Reads/writes `mode` through `toggleMode`, so it stays in
 * sync with anything else that changes theme (system preference, a future
 * settings panel) instead of holding its own local on/off state.
 */

import { resolveMode, useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";

export function ThemeToggle({ className }: { className?: string }) {
  const mode = useTheme((s) => s.mode);
  const toggleMode = useTheme((s) => s.toggleMode);
  const dark = resolveMode(mode) === "dark";

  return (
    <button
      onClick={toggleMode}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        dark ? "border-signal/50 bg-signal" : "border-ink-800/20 bg-ink-800/15",
        className
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 flex size-4 items-center justify-center rounded-full text-[8px] shadow-sm transition-[left] duration-200",
          dark ? "left-[calc(100%-18px)] bg-white" : "left-0.5 bg-white text-ink-500"
        )}
      >
        {dark ? "🌙" : "☀"}
      </span>
    </button>
  );
}
