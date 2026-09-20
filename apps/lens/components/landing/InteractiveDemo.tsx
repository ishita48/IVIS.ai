"use client";

/**
 * A minute of the actual product, on the landing page. Picking an option
 * never reveals a step of the solution: LENS answers every choice with
 * another question, the same rule the real workspace follows.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";

const OPTIONS = [
  {
    id: "subtract",
    label: "Subtract 5 from both sides",
    reply:
      "Good instinct. If you subtract 5 from the left side, what do you have to do to the right side to keep it balanced?",
  },
  {
    id: "divide",
    label: "Divide everything by 2 first",
    reply:
      "You could try that, but 5 isn't being multiplied by x. What happens to it if the whole left side gets divided by 2?",
  },
  {
    id: "guess",
    label: "Guess a number and check",
    reply:
      "That works too. Pick a number for x: what does the left side come out to, and how far off is it from 17?",
  },
];

export function InteractiveDemo() {
  const [choice, setChoice] = useState<string | null>(null);
  const picked = OPTIONS.find((o) => o.id === choice);

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-24 sm:px-10 sm:py-32">
      <p className="text-center text-[11px] font-bold uppercase tracking-[0.25em] text-ink-500">Try it yourself</p>

      <div className="mx-auto mt-10 max-w-lg text-center">
        <p className="font-mono text-[30px] font-bold tracking-tight text-ink-100">2x + 5 = 17</p>

        <div className="mt-9 space-y-2.5">
          <p className="text-[14px] leading-relaxed text-ink-400">I could give you the answer.</p>
          <p className="text-[16px] font-semibold leading-relaxed text-ink-100">But what would you try first?</p>
        </div>

        <div className="mt-7 flex flex-col gap-2.5">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => setChoice(o.id)}
              className={cn(
                "rounded-2xl border px-4 py-3 text-left text-[13.5px] font-medium transition",
                choice === o.id
                  ? "border-signal/40 bg-signal/10 text-ink-100"
                  : "border-ink-800/12 bg-white/40 text-ink-300 hover:border-signal/25 hover:bg-white/60"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {picked && (
            <motion.div
              key={picked.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35 }}
              className="mt-6 rounded-2xl border border-signal/25 bg-signal/8 p-4 text-left text-[13.5px] leading-relaxed text-ink-200"
            >
              {picked.reply}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
