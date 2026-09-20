"use client";

/**
 * LadderStrip — the hint ladder, on the Camera card, always.
 * ─────────────────────────────────────────────────────────────────────
 * The thesis of LENS is not "it asks questions", it is that the sentence
 * for a rung the student has not earned is NEVER GENERATED. That cap is
 * computed server-side from the event log (`nextAllowedLevel`) and the
 * model is clamped to it (`capLevel` in lib/reasoning.ts). This strip is
 * that fact, drawn: rungs LENS has said are lit with the exact sentence,
 * rungs it may say next are open, and rungs above the cap read "not
 * generated" with the number of attempts that would unlock them.
 *
 * The cap is recomputed here from the same pure function over the same
 * events the server reads, so the strip and the engine cannot disagree.
 */

import { Lock } from "lucide-react";
import { HINT_LADDER, type HintLevel } from "@/lib/lens/contracts";
import { countAttempts, nextAllowedLevel } from "@/lib/ladder";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";

const LABEL: Record<HintLevel, string> = {
  OBSERVE: "Look",
  POINT: "Point",
  ASK: "Ask",
  NUDGE: "Nudge",
  EXPERIMENT: "Experiment",
  EXPLAIN: "Explain",
};

export function LadderStrip() {
  const timeline = useLens((s) => s.timeline);
  const reasoning = useLens((s) => s.reasoning);
  const events = useLens((s) => s.events);
  const observation = useLens((s) => s.observation?.observation ?? null);

  const attempts = countAttempts(events);
  const cap = nextAllowedLevel(events);
  const capIdx = HINT_LADDER.indexOf(cap);
  const currentIdx = reasoning && !reasoning.insufficientEvidence ? HINT_LADDER.indexOf(reasoning.hintLevel) : -1;

  // The latest sentence LENS actually said at each rung. Timeline is
  // oldest → newest, so later states overwrite earlier ones.
  const said = new Map<HintLevel, string>();
  for (const s of timeline) {
    if (s.intervention && !s.insufficientEvidence) said.set(s.hintLevel, s.intervention);
  }
  if (reasoning?.intervention && !reasoning.insufficientEvidence) {
    said.set(reasoning.hintLevel, reasoning.intervention);
  }
  if (observation) said.set("OBSERVE", observation);

  return (
    <div className="rounded-3xl glass-panel p-4" aria-label="Hint ladder">
      <div className="mb-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide text-ink-500">
        <span>Hint ladder</span>
        <span className="normal-case tracking-normal">
          {attempts === 0 ? "no attempts yet" : `${attempts} attempt${attempts === 1 ? "" : "s"}`} ·
          unlocked through <span className="font-medium text-ink-300">{LABEL[cap]}</span>
        </span>
      </div>

      <ol className="space-y-1.5">
        {HINT_LADDER.map((level, i) => {
          const sentence = said.get(level);
          const lit = !!sentence;
          const open = !lit && i <= capIdx;
          const locked = i > capIdx;
          const current = i === currentIdx;
          return (
            <li
              key={level}
              className={cn(
                "flex items-start gap-3 rounded-2xl px-3 py-2 transition",
                current && "bg-signal/5 ring-1 ring-signal/30",
                locked && "opacity-60"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-1 size-2.5 shrink-0 rounded-full",
                  lit ? "bg-signal" : open ? "border border-signal/60 bg-transparent" : "bg-ink-800/20"
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={cn("font-semibold uppercase tracking-wide", lit ? "text-signal-deep" : "text-ink-500")}>
                    {LABEL[level]}
                  </span>
                  {locked && (
                    <span className="inline-flex items-center gap-1 text-ink-500">
                      <Lock className="size-3" aria-hidden />
                      not generated · {i - capIdx} more attempt{i - capIdx === 1 ? "" : "s"}
                    </span>
                  )}
                  {open && <span className="text-ink-500">unlocked, not said yet</span>}
                </div>
                {lit && (
                  <p className="mt-0.5 text-[13px] leading-snug text-ink-200">{sentence}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
