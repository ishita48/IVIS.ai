"use client";

/**
 * PredictionCard — the judge is the student now.
 * ─────────────────────────────────────────────────────────────────────
 * One question about the object on the desk, three or four answers, and
 * the popular wrong one is wrong for a reason the curated ladder already
 * knows. The pick is written as a `prediction` event — the same event a
 * spoken prediction produces — and the reasoning engine runs at once, so
 * the ladder lights a rung while the person who was wrong is watching.
 *
 * It never says which answer was right. A wrong pick gets a rung, not a
 * fact; that is the whole product.
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { DEMO_OBJECTIVES, findObjective } from "@/lib/objectives";
import { useLens } from "@/lib/store";

/** A question written from this session's own material. */
type Generated = {
  id: string;
  title: string;
  objective: string;
  question: string;
  options: string[];
};

export function PredictionCard() {
  const storeObjective = useLens((s) => s.objective);
  const setObjective = useLens((s) => s.setObjective);
  const recordEvent = useLens((s) => s.recordEvent);
  const analyzeReasoningNow = useLens((s) => s.analyzeReasoningNow);
  const analyzing = useLens((s) => s.analyzingReasoning);

  const sessionId = useLens((s) => s.sessionId);
  const observation = useLens((s) => s.observation?.observation ?? null);

  const matched = findObjective(storeObjective);

  // Generated from what this student is actually working on. Null until it
  // arrives, and null forever if they have no material and no camera
  // reading yet - in which case the curated questions are still good ones.
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [groundedIn, setGroundedIn] = useState<string[]>([]);
  const [writing, setWriting] = useState(false);

  const write = useCallback(async () => {
    if (writing) return;
    setWriting(true);
    try {
      const res = await fetch("/api/objectives/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, observation }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        objective?: Generated;
        groundedIn?: string[];
      };
      if (res.ok && data.objective) {
        setGenerated(data.objective);
        setGroundedIn(data.groundedIn ?? []);
      }
    } catch {
      // Silent: the curated set is already on screen and still works.
    } finally {
      setWriting(false);
    }
  }, [sessionId, observation, writing]);

  // Ask once the session has something real to ask about. The camera
  // reporting a new object is the other moment worth rewriting for, which
  // is why `observation` is a dependency rather than a one-shot on mount.
  useEffect(() => {
    if (matched) return;
    if (!sessionId && !observation) return;
    void write();
    // `write` is deliberately not a dependency: it changes whenever
    // `writing` flips, which would re-fire this the moment a request ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, observation, matched]);

  // Only reached when the student has no material and no camera reading
  // yet. One sample question is a better empty state than a blank card;
  // the picker that let them browse all three is gone, because a tutor
  // offering a menu of unrelated demos is the thing that looked fake.
  const objective = matched ?? DEMO_OBJECTIVES[0];

  const showGenerated = !matched && !!generated;
  const check = showGenerated
    ? { question: generated!.question, options: generated!.options, correctIndex: -1 }
    : objective.entryCheck;

  // Keyed by objective so switching objects resets the pick.
  const [picked, setPicked] = useState<{ id: string; index: number } | null>(null);
  const activeId = showGenerated ? generated!.id : objective.id;
  const answered = picked?.id === activeId ? picked.index : null;

  if (!check) return null;

  async function pick(i: number) {
    if (answered !== null || analyzing || !check) return;
    const activeId = showGenerated ? generated!.id : objective.id;
    setPicked({ id: activeId, index: i });
    // The ladder is keyed on the objective text; make sure the engine is
    // looking at the same object the question was about.
    if (showGenerated) setObjective(generated!.objective);
    else if (!matched) setObjective(objective.objective);
    await recordEvent("prediction", {
      question: check.question,
      answer: check.options[i],
      objective: showGenerated ? generated!.id : objective.id,
      seeded: !showGenerated,
      generated: showGenerated,
    });
    await analyzeReasoningNow({ spokenText: `I predict ${check.options[i]}.` });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl glass-panel p-4"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-signal-deep">
          Before you touch it — predict
        </span>
        {!matched && writing && (
          <span className="text-[11px] text-ink-400">
            writing a question from your material…
          </span>
        )}
      </div>

      {showGenerated && groundedIn.length > 0 && (
        <p className="mb-1.5 text-[11px] text-ink-500">
          about your {groundedIn.join(", ")}
        </p>
      )}

      <p className="mb-3 text-[14px] font-medium text-ink-100">{check.question}</p>

      <div className="flex flex-col gap-1.5">
        {check.options.map((opt, i) => {
          const isPicked = answered === i;
          return (
            <button
              key={opt}
              type="button"
              disabled={answered !== null}
              onClick={() => pick(i)}
              className={cn(
                "rounded-xl border px-3 py-2 text-left text-[13px] transition",
                answered === null && "border-ink-800/15 hover:border-signal/50 hover:bg-signal/5",
                isPicked && "border-signal/60 bg-signal/10 font-medium text-ink-100",
                answered !== null && !isPicked && "opacity-40"
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {answered !== null && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 text-[12px] leading-relaxed text-ink-400"
        >
          {analyzing
            ? "Recorded. LENS is deciding which rung you've earned…"
            : "Recorded as a prediction. LENS will not say whether it's right — watch the ladder, then turn the crank and press Look."}
        </motion.p>
      )}
    </motion.div>
  );
}
