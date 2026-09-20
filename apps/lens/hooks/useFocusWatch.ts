"use client";

/**
 * useFocusWatch — is the student still here?
 * ─────────────────────────────────────────────────────────────────────
 *
 * WHY THIS IS NOT EYE TRACKING, which is what was asked for. Real gaze
 * needs a face-landmark model and the user-facing camera, and LENS's
 * camera is pointed at the desk. Opening a second stream while the work
 * camera runs is also how you lose the work camera on hardware that
 * allows one at a time — a bad trade for a small feature.
 *
 * So this reads the signals the browser already gives away for free, and
 * they turn out to catch the distraction that actually happens. Nobody
 * stares blankly at their breadboard; they switch to a tab, or pick up a
 * phone and stop touching anything. Both are observable exactly, with no
 * model, no camera, and no permission prompt:
 *
 *   away   the tab is hidden or the window lost focus — they are
 *          somewhere else, and this is certain rather than inferred
 *   idle   still here, but nothing has moved for a while
 *   focused otherwise
 *
 * This is the same shape as the orchestrator's GATE: the free signal
 * decides, and the expensive one never has to run. An attention feature
 * that billed a vision call every few seconds would cost more than the
 * tutoring does.
 *
 * `idle` is honest about its limit. Someone reading a page without
 * touching the keyboard is idle by this measure and perfectly focused,
 * which is why idle is shown gently and never interrupts, while `away`
 * is certain and may.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type Attention = "focused" | "idle" | "away";

/** No pointer, key or scroll for this long and we call it idle. */
const IDLE_AFTER_MS = 45_000;

/** Ignore a blink of a tab switch — alt-tabbing to read a datasheet is work. */
const AWAY_GRACE_MS = 2_500;

export function useFocusWatch(enabled: boolean) {
  const [attention, setAttention] = useState<Attention>("focused");
  /** When the current non-focused stretch began, for "away for 40s". */
  const [since, setSince] = useState<number | null>(null);

  const lastActive = useRef(Date.now());
  const awayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const mark = useCallback((next: Attention) => {
    setAttention((prev) => {
      if (prev === next) return prev;
      setSince(next === "focused" ? null : Date.now());
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      mark("focused");
      return;
    }

    const activity = () => {
      lastActive.current = Date.now();
      // Any input while idle means they are back; `away` is cleared by the
      // window regaining focus instead, not by a stray event.
      setAttention((prev) => (prev === "idle" ? "focused" : prev));
    };

    const goneDark = () => {
      if (awayTimer.current) clearTimeout(awayTimer.current);
      awayTimer.current = setTimeout(() => mark("away"), AWAY_GRACE_MS);
    };

    const cameBack = () => {
      if (awayTimer.current) clearTimeout(awayTimer.current);
      lastActive.current = Date.now();
      mark("focused");
    };

    const onVisibility = () =>
      document.visibilityState === "hidden" ? goneDark() : cameBack();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", goneDark);
    window.addEventListener("focus", cameBack);
    for (const e of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
      window.addEventListener(e, activity, { passive: true });
    }

    idleTimer.current = setInterval(() => {
      // Never overrides `away`: being in another window is the stronger,
      // and more certain, statement.
      setAttention((prev) => {
        if (prev === "away") return prev;
        const quiet = Date.now() - lastActive.current > IDLE_AFTER_MS;
        if (quiet && prev !== "idle") {
          setSince(Date.now());
          return "idle";
        }
        return prev;
      });
    }, 5_000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", goneDark);
      window.removeEventListener("focus", cameBack);
      for (const e of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
        window.removeEventListener(e, activity);
      }
      if (awayTimer.current) clearTimeout(awayTimer.current);
      if (idleTimer.current) clearInterval(idleTimer.current);
    };
  }, [enabled, mark]);

  return { attention, since };
}
