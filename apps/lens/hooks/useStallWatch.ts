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
 *
 * The same watcher answers a second question for free. Because it is already
 * sampling the frame to see whether hands are moving, it knows whether the
 * scene moved at all since the last time we paid a model to look at it. That
 * is `sceneChanged`, and /api/vision/analyze uses it to skip a call whose
 * answer cannot have changed (see lib/frame-cascade.ts). It errs towards
 * `true`: a needless look costs pennies, a wrongly skipped one costs the
 * agent its eyes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a student may sit silent after an agent turn before one check. */
const SILENCE_MS = 15_000;
/** Minimum gap between checks. */
const COOLDOWN_MS = 60_000;
/** Hard cap per session. */
const MAX_CHECKS = 4;
const TICK_MS = 2_000;

/** How often the motion watcher samples the video. */
const MOTION_TICK_MS = 1_000;
/** The grid the diff runs on. Tiny on purpose — this has to be ~free. */
const MOTION_W = 32;
const MOTION_H = 24;
/**
 * Mean per-pixel luma delta (0-255) that counts as movement. Sensor noise in
 * a dim room sits around 1-3; a hand crossing the frame is far above this.
 */
const MOTION_THRESHOLD = 6;

/**
 * Mean absolute luma difference between two RGBA frames of equal size.
 *
 * Returns Infinity when the frames cannot be compared (first sample, or the
 * geometry changed) so the caller reads "moved" — the safe direction.
 */
export function meanLumaDelta(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray
): number {
  if (a.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  let pixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    total += Math.abs(la - lb);
    pixels += 1;
  }
  return pixels ? total / pixels : Number.POSITIVE_INFINITY;
}

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
  /**
   * The live camera element, for the motion watcher behind `sceneChanged`.
   * Optional: without it `sceneChanged` stays true, which is exactly what a
   * caller that cannot measure motion should be telling the server.
   */
  video?: () => HTMLVideoElement | null | undefined;
  log: (kind: "agent" | "error", label: string, detail?: unknown) => void;
};

export function useStallWatch(deps: StallWatchDeps) {
  const ref = useRef(deps);
  ref.current = deps;

  const lastCheckRef = useRef(0);
  const checksRef = useRef(0);
  const busyRef = useRef(false);

  // Movement since the last analyze. Starts true, and stays true whenever we
  // cannot measure — "I do not know" and "it moved" have to mean the same
  // thing here, or the server skips a look it needed to make.
  const [sceneChanged, setSceneChanged] = useState(true);
  const priorFrameRef = useRef<Uint8ClampedArray | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /**
   * Call straight after a frame has actually been sent to the model. Clears
   * the flag so the next look can be skipped if nothing moves in between.
   *
   * The baseline frame is deliberately NOT cleared: comparing against the
   * sample from just before the analyze over-reports movement by up to one
   * tick, and over-reporting is the direction that keeps the agent seeing.
   */
  const markAnalyzed = useCallback(() => setSceneChanged(false), []);

  const reset = useCallback(() => {
    lastCheckRef.current = 0;
    checksRef.current = 0;
    busyRef.current = false;
    priorFrameRef.current = null;
    setSceneChanged(true);
  }, []);

  // The motion watcher. One 32x24 draw a second, entirely local — no frame
  // leaves the machine, and nothing here is billed.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const el = ref.current.video?.();
      // No camera to measure: leave the flag alone. It is true by default and
      // markAnalyzed only clears it once a frame really went out.
      if (!el || el.readyState < 2 || !el.videoWidth || !el.videoHeight) return;

      const canvas =
        canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));
      canvas.width = MOTION_W;
      canvas.height = MOTION_H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      let frame: Uint8ClampedArray;
      try {
        ctx.drawImage(el, 0, 0, MOTION_W, MOTION_H);
        frame = ctx.getImageData(0, 0, MOTION_W, MOTION_H).data;
      } catch {
        // A tainted or not-yet-ready canvas tells us nothing about motion.
        return;
      }

      const prior = priorFrameRef.current;
      priorFrameRef.current = frame;
      if (!prior) return;

      if (meanLumaDelta(prior, frame) >= MOTION_THRESHOLD) {
        // Guarded so a still-moving scene does not re-render every second.
        setSceneChanged((was) => (was ? was : true));
      }
    }, MOTION_TICK_MS);

    return () => window.clearInterval(timer);
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

  return {
    reset,
    checksUsed: () => checksRef.current,
    maxChecks: MAX_CHECKS,
    /** True when the camera has moved since the last `markAnalyzed()`. */
    sceneChanged,
    markAnalyzed,
  };
}
