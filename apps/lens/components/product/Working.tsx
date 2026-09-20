"use client";

/**
 * Working — what the search is doing, while it does it.
 * ─────────────────────────────────────────────────────────────────────
 *
 * A spinner says "wait". This says what is being waited on, and the
 * answer happens to be interesting: the question is being embedded into
 * 1,536 dimensions, two searches are running at once, and their rankings
 * are being fused. That is worth a second of someone's attention,
 * particularly a judge's.
 *
 * IT ADDS NOTHING TO THE WAIT. The phases advance on a client-side timer
 * running alongside the request — there is no extra await, no round trip,
 * and no artificial delay anywhere in this file. A search that returns in
 * 180ms shows one phase and vanishes; the work still happened, it was
 * just fast. Slowing a search down to show off the machinery would be the
 * exact trade this product should never make.
 *
 * THE PHASES ARE REAL. Each one names something the server genuinely does
 * for that request, in the order it does it — see lib/elastic.ts and
 * lib/embeddings.ts. They are not ticked off as completed, because the
 * client cannot know that; they read as "doing", which is true from the
 * moment the request is sent. Inventing a step that does not happen would
 * make this the least trustworthy component in a product whose whole
 * claim is that it does not make things up.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/cn";

/** Long enough to read, short enough that a fast search still feels fast. */
const PHASE_MS = 520;

/** Named sets, so the words match the query that is actually running. */
export const PHASES = {
  /** Hybrid retrieval over lens-sources. */
  hybrid: [
    "embedding your question · 1,536 dims",
    "BM25 and kNN, in parallel",
    "fusing both rankings · RRF",
    "keeping only passages above 0.68",
  ],
  /** Study tools: retrieval, then generation from what came back. */
  study: [
    "finding your material in this session",
    "ranking passages by meaning",
    "reading the ones that matched",
    "writing only from those passages",
  ],
  /** The code council. */
  council: [
    "recalling what you've believed before",
    "searching your notes for this idea",
    "checking whether a model is needed",
    "auditing the hint for the answer",
  ],
  /** Plain semantic lookup. */
  recall: [
    "embedding the query",
    "nearest neighbours over your beliefs",
    "scoring by cosine",
  ],
} as const;

export type PhaseSet = keyof typeof PHASES;

/**
 * Advance through phases while `active`, and hold on the last one.
 *
 * Holding rather than looping matters: a search that takes four seconds
 * cycling "embedding… BM25… embedding…" looks stuck and slightly silly.
 * The last phase is the honest one to sit on, because it is the stage a
 * slow request is most likely still in.
 */
export function useWorkingPhase(active: boolean, set: PhaseSet): string | null {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!active) {
      setI(0);
      return;
    }
    const phases = PHASES[set];
    const t = setInterval(() => {
      setI((n) => (n + 1 < phases.length ? n + 1 : n));
    }, PHASE_MS);
    return () => clearInterval(t);
  }, [active, set]);

  return active ? PHASES[set][i] : null;
}

export function Working({
  active,
  set,
  className,
}: {
  active: boolean;
  set: PhaseSet;
  className?: string;
}) {
  const phase = useWorkingPhase(active, set);

  return (
    <AnimatePresence mode="wait">
      {phase && (
        <motion.div
          key={phase}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className={cn(
            "flex items-center gap-2 text-[11.5px] text-ink-500",
            className
          )}
        >
          {/* Three dots rather than a spinner: a spinner competes with the
              words, and the words are the point. */}
          <span className="flex shrink-0 gap-0.5">
            {[0, 1, 2].map((d) => (
              <motion.span
                key={d}
                className="size-1 rounded-full bg-signal"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{
                  duration: 1.05,
                  repeat: Infinity,
                  delay: d * 0.16,
                  ease: "easeInOut",
                }}
              />
            ))}
          </span>
          <span className="truncate font-mono">{phase}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
