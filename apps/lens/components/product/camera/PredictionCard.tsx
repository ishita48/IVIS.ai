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

import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { DEMO_OBJECTIVES, findObjective } from "@/lib/objectives";
import { useLens } from "@/lib/store";

export function PredictionCard() {
  const storeObjective = useLens((s) => s.objective);
  const setObjective = useLens((s) => s.setObjective);
  const recordEvent = useLens((s) => s.recordEvent);
  const analyzeReasoningNow = useLens((s) => s.analyzeReasoningNow);
  const analyzing = useLens((s) => s.analyzingReasoning);

  const matched = findObjective(storeObjective);
  const [chosenId, setChosenId] = useState<string>(DEMO_OBJECTIVES[0].id);
  const objective =
    matched ?? DEMO_OBJECTIVES.find((o) => o.id === chosenId) ?? DEMO_OBJECTIVES[0];
  const check = objective.entryCheck;

  // Keyed by objective so switching objects resets the pick.
  const [picked, setPicked] = useState<{ id: string; index: number } | null>(null);
  const answered = picked?.id === objective.id ? picked.index : null;

  if (!check) return null;

  async function pick(i: number) {
    if (answered !== null || analyzing || !check) return;
    setPicked({ id: objective.id, index: i });
    // The ladder is keyed on the objective text; make sure the engine is
    // looking at the same object the question was about.
    if (!matched) setObjective(objective.objective);
    await recordEvent("prediction", {
      question: check.question,
      answer: check.options[i],
      objective: objective.id,
      seeded: true,
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
        {!matched && (
          <div className="flex flex-wrap gap-1">
            {DEMO_OBJECTIVES.filter((o) => o.entryCheck).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setChosenId(o.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] transition",
                  o.id === objective.id
                    ? "bg-signal/10 font-medium text-signal-deep"
                    : "glass-chip text-ink-400 hover:text-ink-200"
                )}
              >
                {o.title}
              </button>
            ))}
          </div>
        )}
      </div>

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
