"use client";

/**
 * Persona store — which "mode" of LENS a signed-in user sees: the student
 * workspace (/app) or the teacher dashboard (/app/teacher).
 * ─────────────────────────────────────────────────────────────────────
 * There is no backend field for role yet, so this is a frontend-only
 * stand-in: persisted to localStorage per browser, same pattern as
 * lib/theme.ts. Once accounts carry a real role, swap `hydrate()` for a
 * fetch of that value and this store's shape doesn't need to change.
 */

import { create } from "zustand";

export type Persona = "teacher" | "student";

type PersonaState = {
  persona: Persona | null;
  hydrated: boolean;
  setPersona: (p: Persona) => void;
  hydrate: () => void;
};

const KEY = "studio:persona:v1";

function readPersisted(): Persona | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "teacher" || raw === "student" ? raw : null;
  } catch {
    return null;
  }
}

function writePersisted(p: Persona | null) {
  if (typeof window === "undefined") return;
  try {
    if (p) localStorage.setItem(KEY, p);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage may be blocked — ignore */
  }
}

export const usePersona = create<PersonaState>((set) => ({
  persona: null,
  hydrated: false,
  setPersona: (persona) => {
    set({ persona });
    writePersisted(persona);
  },
  hydrate: () => {
    set({ persona: readPersisted(), hydrated: true });
  },
}));
