import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnboarding } from "./onboarding";
import { usePersona } from "./persona";

const KEY = "studio:onboarding:v1";
const PERSONA_KEY = "studio:persona:v1";
const saved = {
  studentComplete: false,
  teacherComplete: true,
  student: { subjects: ["Physics"], styles: ["Visual"], goal: "Project" },
  teacher: {
    subjects: ["Mathematics"], className: "Algebra", subject: "Mathematics",
    description: "Practice", goals: ["Share resources"],
  },
};
let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useOnboarding.setState(useOnboarding.getInitialState(), true);
  usePersona.setState(usePersona.getInitialState(), true);
});

afterEach(() => vi.unstubAllGlobals());

describe("onboarding persistence", () => {
  it("hydrates saved completion and preferences for both personas", () => {
    // Returning users should keep their setup in this browser.
    storage.set(KEY, JSON.stringify(saved));
    useOnboarding.getState().hydrate();
    expect(useOnboarding.getState()).toMatchObject({ hydrated: true, ...saved });
  });

  it.each([null, "invalid JSON"])("hydrates defaults when storage is missing or unreadable: %s", (raw) => {
    // A new browser or corrupt storage must not block the gate forever.
    if (raw !== null) storage.set(KEY, raw);
    useOnboarding.getState().hydrate();
    expect(useOnboarding.getState()).toMatchObject({
      hydrated: true, studentComplete: false, teacherComplete: false,
      student: { subjects: [], styles: [], goal: null },
      teacher: { subjects: [], className: "", subject: "", description: "", goals: [] },
    });
  });

  it("fills missing preferences when hydrating an older partial record", () => {
    // Persisted records need not contain every current preference field.
    storage.set(KEY, JSON.stringify({ student: { subjects: ["Physics"] } }));
    useOnboarding.getState().hydrate();
    expect(useOnboarding.getState().student).toEqual({ subjects: ["Physics"], styles: [], goal: null });
  });

  it.each(["student", "teacher"] as const)("completes and persists %s without changing the other persona", (persona) => {
    // Finishing one wizard must preserve both personas' preferences.
    storage.set(KEY, JSON.stringify({ ...saved, teacherComplete: false }));
    useOnboarding.getState().hydrate();
    if (persona === "student") useOnboarding.getState().completeStudent();
    else useOnboarding.getState().completeTeacher();
    const expected = { ...saved, studentComplete: persona === "student", teacherComplete: persona === "teacher" };
    expect(JSON.parse(storage.get(KEY)!)).toEqual(expected);
    useOnboarding.setState(useOnboarding.getInitialState(), true);
    useOnboarding.getState().hydrate();
    expect(useOnboarding.getState()).toMatchObject(expected);
  });

  it.each([null, "student", "teacher"] as const)("skips from persona %s and survives a fresh hydration", (persona) => {
    // Every entry point must land in the completed student workspace in one click.
    if (persona) usePersona.getState().setPersona(persona);
    useOnboarding.getState().skip();
    expect(usePersona.getState().persona).toBe("student");
    expect(useOnboarding.getState().studentComplete).toBe(true);
    expect(storage.get(PERSONA_KEY)).toBe("student");
    usePersona.setState(usePersona.getInitialState(), true);
    useOnboarding.setState(useOnboarding.getInitialState(), true);
    usePersona.getState().hydrate();
    useOnboarding.getState().hydrate();
    expect(usePersona.getState().persona).toBe("student");
    expect(useOnboarding.getState()).toMatchObject({ hydrated: true, studentComplete: true, teacherComplete: false });
  });

  it("hydrates before skipping so a direct wizard visit preserves saved teacher setup", () => {
    // Skipping must not overwrite preferences that have not been loaded yet.
    storage.set(KEY, JSON.stringify(saved));
    useOnboarding.getState().skip();
    expect(JSON.parse(storage.get(KEY)!)).toEqual({ ...saved, studentComplete: true });
  });

  it("keeps current wizard edits and completes before publishing the student persona", () => {
    // PersonaGate must never observe student mode before completion is ready.
    useOnboarding.getState().hydrate();
    useOnboarding.getState().setStudent({ goal: "Interview" });
    const observed: boolean[] = [];
    const unsubscribe = usePersona.subscribe(() => observed.push(useOnboarding.getState().studentComplete));
    try {
      useOnboarding.getState().skip();
    } finally {
      unsubscribe();
    }
    expect(observed).toEqual([true]);
    expect(useOnboarding.getState().student.goal).toBe("Interview");
  });

  it("preserves onboarding state when switching personas with the PersonaBadge action", () => {
    // Switching views must never erase either wizard's saved completion or answers.
    storage.set(KEY, JSON.stringify(saved));
    useOnboarding.getState().skip();
    const persisted = storage.get(KEY);
    usePersona.getState().setPersona("teacher");
    usePersona.getState().setPersona("student");
    expect(storage.get(KEY)).toBe(persisted);
    expect(useOnboarding.getState()).toMatchObject({ ...saved, studentComplete: true });
  });

  it("allows skipping for the current session when browser storage is blocked", () => {
    // Storage restrictions should not make the skip control unusable.
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(() => useOnboarding.getState().skip()).not.toThrow();
    expect(usePersona.getState().persona).toBe("student");
    expect(useOnboarding.getState().studentComplete).toBe(true);
  });
});
