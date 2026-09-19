"use client";

/**
 * Theme + UI preferences store.
 * ─────────────────────────────────────────────────────────────────────
 * Kept deliberately small — persisted to localStorage so the user's
 * choice survives reloads. The ThemeProvider component reads this store
 * and applies the class/CSS vars to <html>.
 */

import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type TextSize = "sm" | "md" | "lg" | "xl";
export type Density = "comfortable" | "compact";

type ThemeState = {
  mode: ThemeMode;
  textSize: TextSize;
  density: Density;
  reducedMotion: boolean;
  hydrated: boolean;

  setMode: (m: ThemeMode) => void;
  toggleMode: () => void;
  setTextSize: (s: TextSize) => void;
  setDensity: (d: Density) => void;
  setReducedMotion: (v: boolean) => void;
  hydrate: () => void;
};

const KEY = "studio:theme:v1";

function readPersisted(): Partial<ThemeState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writePersisted(s: ThemeState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        mode: s.mode,
        textSize: s.textSize,
        density: s.density,
        reducedMotion: s.reducedMotion,
      })
    );
  } catch {
    /* storage may be blocked — ignore */
  }
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: "light",
  textSize: "md",
  density: "comfortable",
  reducedMotion: false,
  hydrated: false,

  setMode: (mode) => {
    set({ mode });
    writePersisted(get());
  },
  toggleMode: () => {
    const cur = get();
    // system counts as whatever it resolves to — so toggle flips to the
    // explicit opposite.
    const resolved = cur.mode === "dark" ? "dark" : cur.mode === "light" ? "light" : resolveSystem();
    const next: ThemeMode = resolved === "dark" ? "light" : "dark";
    set({ mode: next });
    writePersisted(get());
  },
  setTextSize: (textSize) => {
    set({ textSize });
    writePersisted(get());
  },
  setDensity: (density) => {
    set({ density });
    writePersisted(get());
  },
  setReducedMotion: (reducedMotion) => {
    set({ reducedMotion });
    writePersisted(get());
  },
  hydrate: () => {
    const persisted = readPersisted();
    set({ ...persisted, hydrated: true });
  },
}));

export function resolveSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveMode(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? resolveSystem() : mode;
}
