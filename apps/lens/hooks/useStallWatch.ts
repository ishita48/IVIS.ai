"use client";

/**
 * useStallWatch — notice when the student has gone quiet, and check once.
 *
 * The obvious version of "detect confusion" reads the student's face on a
 * timer. That is wrong three ways: it streams frames continuously to an API
 * (which this product does not do), it bills for every check, and facial
 * affect is a terrible signal — a furrowed brow is concentration as often as
 * it is confusion, so it generates exactly the false positives that make a
 * tutor feel like it is nagging.
 *
 * Instead the cheap signal gates the expensive one:
 *
 *   1. Free, from data already in hand: the agent asked something, and the
 *      student has not spoken since. Silence after a question is the oldest
 *      stuck-signal there is, and it costs nothing to watch.
 *   2. Only then, ONE frame — asking whether they appear stalled, not what
 *      they are feeling. Hands that have stopped moving say far more than a
 *      face does, and it sidesteps reading emotion off someone entirely.
 *   3. The result is handed to the agent as CONTEXT, never as an interruption.
 *      sendContextualUpdate does not force a reply. The agent already knows
 *      what it asked and how hard it was; it decides whether to say anything.
 *
 * Plus a cooldown and a per-session cap, because the failure mode of this
 * feature is a tutor that keeps asking if you are okay.
 */

import { useCallback, useEffect, useRef } from "react";

/** How long a student may sit silent after an agent turn before one check. */
const SILENCE_MS = 15_000;
/** Minimum gap between checks. */
const COOLDOWN_MS = 60_000;
/** Hard cap per session. */
const MAX_CHECKS = 4;
const TICK_MS = 2_000;

export type StallWatchDeps = {
  enabled: boolean;
  /** True only when connected and not mid-turn. */
  idle: boolean;
  /** Timestamp of the agent's most recent utterance, 0 if none. */
  lastAgentAt: number;
  /** Timestamp of the student's most recent utterance, 0 if none. */
  lastStudentAt: number;
  /** One frame, described. Should reject rather than invent. */
  look: (objective: string) => Promise<{ observation: string; confidence: number }>;
  /** Out-of-band note to the agent. Must not force a reply. */
  sendContext: (text: string) => void;
  log: (kind: "agent" | "error", label: string, detail?: unknown) => void;
};

export function useStallWatch(deps: StallWatchDeps) {
  const ref = useRef(deps);
  ref.current = deps;

  const lastCheckRef = useRef(0);
  const checksRef = useRef(0);
  const busyRef = useRef(false);

  const reset = useCallback(() => {
    lastCheckRef.current = 0;
    checksRef.current = 0;
    busyRef.current = false;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const d = ref.current;
      if (!d.enabled || !d.idle || busyRef.current) return;
      if (checksRef.current >= MAX_CHECKS) return;

      const now = Date.now();
      if (now - lastCheckRef.current < COOLDOWN_MS) return;

      // The agent must have spoken last — otherwise the silence is just the
      // student thinking between their own turns, which is not a stall.
      if (!d.lastAgentAt || d.lastAgentAt <= d.lastStudentAt) return;

      const silentFor = now - d.lastAgentAt;
      if (silentFor < SILENCE_MS) return;

      busyRef.current = true;
      lastCheckRef.current = now;
      checksRef.current += 1;

      try {
        const seconds = Math.round(silentFor / 1000);
        const result = await d.look(
          "The student has gone quiet. Describe whether they appear to be actively working — hands moving, handling the object, attention on the work — or stalled: hands still, sitting back, looking away from the workspace. Describe only what is visible. Do not guess at emotion."
        );

        // A frame we could not read is not evidence of anything.
        if (result.confidence < 0.4) {
          d.log("agent", `stall check inconclusive (conf ${result.confidence.toFixed(2)}) — staying quiet`);
          return;
        }

        d.log("agent", `stall check after ${seconds}s silence — handed to agent as context`, result);

        // Context, not a command. The agent decides whether this is worth a
        // turn; it knows what it asked and how hard the question was.
        d.sendContext(
          `Silent observation, not something the student said: they have not spoken for about ${seconds} seconds since your last turn. Looking at them now: ${result.observation} ` +
            `If that reads as stuck rather than working, you may check in once, briefly and without pressure, or offer the next rung. If they look like they are working, say nothing and let them work.`
        );
      } catch (err) {
        d.log("error", `stall check failed — ${err instanceof Error ? err.message : "unknown"}`);
      } finally {
        busyRef.current = false;
      }
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, []);

  return { reset, checksUsed: () => checksRef.current, maxChecks: MAX_CHECKS };
}
