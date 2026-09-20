"use client";

/**
 * ReasoningGraph — the student model, rebuilt from real events.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 1, data from Person 2.
 *
 * A vertical timeline, not React Flow. Section 16.1 of the PDR ranks the
 * graph BELOW the core loop for a reason: a list that renders real
 * recorded states beats a force-directed graph that renders nothing
 * because the layout library is fighting you at hour 30. Upgrade the
 * visual only once everything above it is done.
 *
 * Every node is one `reasoning_states` document. When the engine has fewer
 * than two real events it says so instead of inventing a misconception —
 * that honesty is a feature, and worth pointing at during the demo.
 */

import { motion } from "framer-motion";
import { Brain, CircleDashed, Loader2 } from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";
import { HINT_LADDER, eventLabel } from "@/lib/lens/contracts";
import { PipelineTrace } from "./PipelineTrace";

export function ReasoningGraph() {
  const timeline = useLens((s) => s.timeline);
  const events = useLens((s) => s.events);
  const analyzing = useLens((s) => s.analyzingReasoning);
  const analyzeNow = useLens((s) => s.analyzeReasoningNow);
  const hasSession = useLens((s) => !!s.sessionId);
  const note = useLens((s) => s.reasoningNote);

  const real = timeline.filter((t) => !t.insufficientEvidence);

  return (
    <div className="flex h-full min-h-0 gap-3 overflow-hidden p-3">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex shrink-0 items-center justify-end gap-3">
        {note && (
          <span
            className={cn(
              "text-[12px]",
              note.kind === "error" ? "text-rose-600" : "text-ink-500"
            )}
          >
            {note.text}
          </span>
        )}
        <button
          onClick={() => analyzeNow()}
          disabled={analyzing || !hasSession}
          className="flex items-center gap-1.5 rounded-full bg-signal px-3 py-1.5 text-[12px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white disabled:opacity-40"
        >
          {analyzing && <Loader2 className="size-3.5 animate-spin" />}
          {analyzing ? "Analyzing..." : "Analyze now"}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-slim">
        <PipelineTrace />
        {real.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <CircleDashed className="size-9 text-ink-600" />
            <p className="max-w-sm text-[13px] leading-relaxed text-ink-500">
              Not enough evidence yet. LENS needs to watch you actually do
              something — analyze a frame, answer a question — before it will
              claim to know what you&apos;re thinking.
            </p>
          </div>
        ) : (
          <ol className="relative space-y-3 pl-6">
            <div className="absolute bottom-2 left-[9px] top-2 w-px bg-ink-800/20" />
            {real.map((state, i) => (
              <motion.li
                key={state._id ?? i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
                className="relative"
              >
                <span className="absolute -left-6 top-3 size-[10px] rounded-full bg-signal ring-4 ring-signal/20" />
                <div className="rounded-2xl border border-ink-800/15 bg-white/60 p-4 backdrop-blur">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-deep">
                      {state.nextAction.replace(/_/g, " ")}
                    </span>
                    <LadderPip level={state.hintLevel} />
                  </div>

                  {state.probableBelief && (
                    <p className="text-[13px] text-ink-200">
                      <span className="text-ink-500">Seems to believe: </span>
                      {state.probableBelief}
                    </p>
                  )}
                  {state.misconception && (
                    <p className="mt-1 text-[13px] text-ink-200">
                      <span className="text-ink-500">Diverges at: </span>
                      {state.misconception}
                    </p>
                  )}
                  {state.intervention && (
                    <p className="mt-2 rounded-xl bg-signal/5 px-3 py-2 text-[13px] text-ink-200">
                      {state.intervention}
                    </p>
                  )}

                  {state.evidence.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {state.evidence.map((e, j) => (
                        <li key={j} className="text-[11px] text-ink-500">
                          · {e}
                        </li>
                      ))}
                    </ul>
                  )}

                  {state.citations && state.citations.length > 0 && (
                    <div className="mt-3 border-t border-ink-800/10 pt-2">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
                        Grounded in your notes
                      </div>
                      <ul className="space-y-2">
                        {state.citations.map((c, j) => (
                          <li key={`${c.sourceId}-${j}`} className="text-[12px]">
                            <div className="flex flex-wrap items-center gap-1.5 font-medium text-ink-300">
                              {c.title}
                              {c.contradicts && (
                                <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                                  Contradicts what you did
                                </span>
                              )}
                            </div>
                            <blockquote className="mt-0.5 border-l-2 border-signal/40 pl-2 text-ink-500">
                              “{c.quote}”
                            </blockquote>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* A confidence needs a belief to be confident about. */}
                  {state.probableBelief && (
                    <div className="mt-2 text-[11px] text-ink-500">
                      {/* Never "certain" — this is a model's guess about a person. */}
                      {Math.round(state.confidence * 100)}% likely
                    </div>
                  )}
                </div>
              </motion.li>
            ))}
          </ol>
        )}
      </div>
      </div>

      <aside className="w-[280px] shrink-0 overflow-y-auto scrollbar-slim">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          <Brain className="size-3.5" />
          Raw event log
        </div>
        <div className="space-y-1">
          {events.length === 0 && (
            <p className="text-[12px] text-ink-500">No events recorded yet.</p>
          )}
          {events
            .slice()
            .reverse()
            .map((e) => (
              <div
                key={e._id}
                className="rounded-lg border border-ink-800/10 bg-white/40 px-2.5 py-1.5"
              >
                <div className="text-[11px] font-medium text-ink-300">
                  {eventLabel(e)}
                </div>
                {e.concept && (
                  <div className="text-[10px] text-signal-deep">{e.concept}</div>
                )}
              </div>
            ))}
        </div>
      </aside>
    </div>
  );
}

function LadderPip({ level }: { level: string }) {
  const idx = HINT_LADDER.indexOf(level as any);
  return (
    <span className="flex items-center gap-1" title={`Hint ladder: ${level}`}>
      {HINT_LADDER.map((l, i) => (
        <span
          key={l}
          className={cn(
            "size-1.5 rounded-full",
            i <= idx ? "bg-signal" : "bg-ink-800/20"
          )}
        />
      ))}
    </span>
  );
}
