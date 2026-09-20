"use client";

/**
 * Onboarding store — tracks whether a signed-in user has finished the
 * first-time setup wizard for their persona, plus what they told us during
 * it. Frontend-only, same reasoning as lib/persona.ts: there's no account
 * field for this yet, so it's persisted per-browser until there's a real
 * place to send it.
 */

import { create } from "zustand";

export type StudentPrefs = {
  subjects: string[];
  styles: string[];
  goal: string | null;
};

export type TeacherPrefs = {
  subjects: string[];
  className: string;
  subject: string;
  description: string;
  goals: string[];
};

type OnboardingState = {
  hydrated: boolean;
  studentComplete: boolean;
  teacherComplete: boolean;
  student: StudentPrefs;
  teacher: TeacherPrefs;

  hydrate: () => void;
  setStudent: (patch: Partial<StudentPrefs>) => void;
  setTeacher: (patch: Partial<TeacherPrefs>) => void;
  completeStudent: () => void;
  completeTeacher: () => void;
};

const KEY = "studio:onboarding:v1";

const DEFAULT_STUDENT: StudentPrefs = { subjects: [], styles: [], goal: null };
const DEFAULT_TEACHER: TeacherPrefs = { subjects: [], className: "", subject: "", description: "", goals: [] };

type Persisted = {
  studentComplete: boolean;
  teacherComplete: boolean;
  student: StudentPrefs;
  teacher: TeacherPrefs;
};

function readPersisted(): Persisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePersisted(s: OnboardingState) {
  if (typeof window === "undefined") return;
  try {
    const payload: Persisted = {
      studentComplete: s.studentComplete,
      teacherComplete: s.teacherComplete,
      student: s.student,
      teacher: s.teacher,
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* storage may be blocked — ignore */
  }
}

export const useOnboarding = create<OnboardingState>((set, get) => ({
  hydrated: false,
  studentComplete: false,
  teacherComplete: false,
  student: DEFAULT_STUDENT,
  teacher: DEFAULT_TEACHER,

  hydrate: () => {
    const persisted = readPersisted();
    set({
      hydrated: true,
      studentComplete: persisted?.studentComplete ?? false,
      teacherComplete: persisted?.teacherComplete ?? false,
      student: { ...DEFAULT_STUDENT, ...persisted?.student },
      teacher: { ...DEFAULT_TEACHER, ...persisted?.teacher },
    });
  },
  setStudent: (patch) => {
    set((s) => ({ student: { ...s.student, ...patch } }));
    writePersisted(get());
  },
  setTeacher: (patch) => {
    set((s) => ({ teacher: { ...s.teacher, ...patch } }));
    writePersisted(get());
  },
  completeStudent: () => {
    set({ studentComplete: true });
    writePersisted(get());
  },
  completeTeacher: () => {
    set({ teacherComplete: true });
    writePersisted(get());
  },
}));
