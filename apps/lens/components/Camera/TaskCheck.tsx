"use client";

/**
 * TaskCheck — say what you're doing, then ask if you've done it.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The other camera modes watch and ask questions. This one answers a
 * specific question the other modes refuse: "is this right yet?" That is
 * not the answer to the problem, it is a verdict on work the student
 * already did — the same thing the Code tab does by running their program
 * and reporting a failing case.
 *
 * THE BADGE IS THE POINT. A sentence in a transcript is the wrong shape
 * for feedback on something happening under your hands: the student is
 * looking at the board, not the screen. So the verdict lands on the video
 * itself, big, in one glance — and it is deliberately the only thing on
 * screen that ever celebrates.
 *
 * `almost` is where the promise is easiest to break, because saying what
 * is missing IS the fix for a physical task. The server prompt forbids it
 * and this UI does not ask for more: it shows where to look and what LENS
 * saw, never what to change.
 *
 * `unclear` is a real verdict, not an error. A dim desk at a bad angle
 * produces a guess, and a tutor that says "done!" to a guess teaches the
 * student to distrust every later yes.
 */

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Loader2, Target, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type TaskVerdict = {
  status: "done" | "almost" | "not_yet" | "unclear";
  detail: string;
  seen: string;
  confidence: number;
};

/** One glance has to carry it, so each verdict gets its own face. */
const FACE: Record<
  TaskVerdict["status"],
  { emoji: string; label: string; ring: string; chip: string }
> = {
  done: {
    emoji: "🎉",
    label: "That's it",
    ring: "ring-emerald-400/70",
    chip: "bg-emerald-500 text-white",
  },
  almost: {
    emoji: "🔍",
    label: "Almost",
    ring: "ring-amber-400/70",
    chip: "bg-amber-500 text-white",
  },
  not_yet: {
    emoji: "🛠️",
    label: "Not yet",
    ring: "ring-rose-400/60",
    chip: "bg-rose-500 text-white",
  },
  unclear: {
    emoji: "👀",
    label: "Can't see it",
    ring: "ring-ink-400/40",
    chip: "bg-ink-700 text-white",
  },
};

/**
 * The badge that sits over the video. Rendered by CameraView inside the
 * video's own relative container so it tracks the frame, not the page.
 */
export function TaskBadge({
  verdict,
  onDismiss,
}: {
  verdict: TaskVerdict | null;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence>
      {verdict && (
        <motion.div
          key={verdict.status + verdict.detail}
          initial={{ opacity: 0, scale: 0.9, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center"
        >
          <div
            className={cn(
              "pointer-events-auto flex max-w-lg items-start gap-3 rounded-2xl bg-ink-950/85 px-4 py-3 ring-2 backdrop-blur",
              FACE[verdict.status].ring
            )}
          >
            <motion.span
              // The celebration is the one flourish in the product, and it
              // only fires on a real pass.
              animate={
                verdict.status === "done"
                  ? { scale: [1, 1.25, 1], rotate: [0, -8, 8, 0] }
                  : {}
              }
              transition={{ duration: 0.7 }}
              className="text-[26px] leading-none"
            >
              {FACE[verdict.status].emoji}
            </motion.span>

            <div className="min-w-0">
              <div className="mb-0.5 flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    FACE[verdict.status].chip
                  )}
                >
                  {FACE[verdict.status].label}
                </span>
                <span className="font-mono text-[10px] text-white/50">
                  {Math.round(verdict.confidence * 100)}% sure
                </span>
              </div>
              {verdict.detail && (
                <p className="text-[13px] leading-snug text-white">{verdict.detail}</p>
              )}
              {verdict.seen && (
                <p className="mt-1 text-[11px] leading-snug text-white/60">
                  saw: {verdict.seen}
                </p>
              )}
            </div>

            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              className="ml-1 shrink-0 rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The task bar: state the task once, then ask as often as you like.
 *
 * `grabFrame` is passed in rather than the video element, so this never
 * has to know how CameraView captures — and so it cannot capture at a
 * moment CameraView considers invalid.
 */
export function TaskBar({
  sessionId,
  grabFrame,
  onVerdict,
}: {
  sessionId: string | null;
  grabFrame: () => string | null;
  onVerdict: (v: TaskVerdict | null) => void;
}) {
  const [task, setTask] = useState("");
  const [committed, setCommitted] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const which = committed ?? task.trim();
    if (!which || checking) return;

    const frame = grabFrame();
    if (!frame) {
      setError("The camera isn't running yet.");
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/vision/task-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: which, frameDataUrl: frame, sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as TaskVerdict & { error?: string };
      if (!res.ok || !data.status) throw new Error(data.error || "Couldn't check that.");
      setCommitted(which);
      onVerdict(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check that.");
    } finally {
      setChecking(false);
    }
  }, [committed, task, checking, grabFrame, sessionId, onVerdict]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-signal/25 bg-signal/[0.06] p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-signal-deep">
        <Target className="size-3.5" />
        Task mode
      </div>

      {committed ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-100">
            {committed}
          </span>
          <button
            onClick={() => {
              setCommitted(null);
              setTask("");
              onVerdict(null);
            }}
            className="rounded-lg px-2 py-1 text-[11px] text-ink-500 transition hover:text-ink-200"
          >
            change
          </button>
        </div>
      ) : (
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && check()}
          placeholder="What are you trying to do? e.g. wire the LED so it lights"
          className="w-full rounded-xl border border-ink-800/15 bg-white px-3 py-2 text-[13px] outline-none focus:border-signal/50"
        />
      )}

      <button
        onClick={check}
        disabled={checking || (!committed && !task.trim())}
        className="flex items-center justify-center gap-1.5 rounded-xl bg-signal px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-card transition hover:brightness-105 disabled:opacity-50"
      >
        {checking ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
        {checking ? "Looking…" : committed ? "Did I get it right?" : "Start and check"}
      </button>

      {error && <p className="text-[11.5px] text-rose-600">{error}</p>}

      <p className="text-[11px] leading-snug text-ink-500">
        LENS tells you whether it&apos;s right, and where to look if it
        isn&apos;t. It still won&apos;t tell you what to change.
      </p>
    </div>
  );
}
