"use client";

/**
 * PipelineTrace — what LENS did before it said anything.
 *
 * The trace is on screen rather than in a log because the two claims this
 * product makes about its own reasoning are otherwise unfalsifiable:
 *
 *   "the cheap pass makes the expensive one affordable" — visible as a
 *   GATE that skipped two model calls, with the similarity that let it.
 *
 *   "it checks itself" — visible as a VERIFY step that can say REJECTED,
 *   and a diagnosis that then does not get spoken.
 *
 * A step that did not run says so, and says why. A verification that could
 * not run reads NOT CHECKED, never "supported" — a trace that quietly
 * upgrades a failure to a pass is worse than no trace.
 */

import { useState } from "react";
import { Ban, Check, Cpu, Loader2, Play, X, Zap } from "lucide-react";
import { useLens } from "@/lib/store";
import type { OrchestratorTrace, TraceStep } from "@/lib/lens/contracts";

export function PipelineTrace() {
  const sessionId = useLens((s) => s.sessionId);
  const [trace, setTrace] = useState<OrchestratorTrace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        trace?: OrchestratorTrace;
        error?: string;
      };
      if (!res.ok || !data.trace) throw new Error(data.error || "The pipeline failed.");
      setTrace(data.trace);
      await Promise.all([
        useLens.getState().refreshReasoning(),
        useLens.getState().refreshMetrics(),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The pipeline failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-ink-800/15 bg-white/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-ink-100">Reasoning pipeline</p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            Four passes. The free one decides whether the paid ones run.
          </p>
        </div>
        <button
          onClick={() => void run()}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-signal px-3.5 py-2 text-[12px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          Run it
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-300/40 bg-rose-50/60 p-2.5 text-[12px] text-rose-700">
          {error}
        </div>
      )}

      {trace && (
        <>
          <ol className="mt-4 space-y-1.5">
            {trace.steps.map((step, i) => (
              <Step key={`${step.step}-${i}`} step={step} />
            ))}
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-800/10 pt-3 text-[11px]">
            <span className="text-ink-500">
              <span className="font-semibold text-ink-200">{trace.modelCalls}</span>{" "}
              model call{trace.modelCalls === 1 ? "" : "s"}
            </span>
            {trace.callsAvoided > 0 && (
              <span className="font-medium text-signal-deep">
                {trace.callsAvoided} avoided
              </span>
            )}
            <span className="text-ink-500">{trace.totalMs}ms</span>
            {trace.verified === false && (
              <span className="font-medium text-rose-500">
                diagnosis rejected — not spoken
              </span>
            )}
            {trace.verified === true && (
              <span className="text-ink-500">diagnosis independently checked</span>
            )}
            {trace.verified === null && trace.callsAvoided === 0 && (
              <span className="text-amber-600">not checked</span>
            )}
          </div>

          {trace.verifyNote && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
              {trace.verifyNote}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Step({ step }: { step: TraceStep }) {
  const skipped = !!step.skipped;
  const rejected = step.summary.startsWith("REJECTED");
  const unchecked = step.summary.startsWith("NOT CHECKED");

  const Icon = skipped ? Ban : step.kind === "model" ? Cpu : Zap;

  return (
    <li
      className={`flex items-start gap-2.5 rounded-xl px-3 py-2 ${
        rejected
          ? "bg-rose-500/[0.07]"
          : skipped
            ? "bg-ink-800/[0.03]"
            : step.kind === "deterministic"
              ? "bg-signal/[0.06]"
              : "bg-white/60"
      }`}
    >
      <Icon
        className={`mt-0.5 size-3.5 shrink-0 ${
          rejected
            ? "text-rose-500"
            : skipped
              ? "text-ink-500"
              : step.kind === "deterministic"
                ? "text-signal-deep"
                : "text-ink-400"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-300">
            {step.step}
          </span>
          <span className="text-[10px] text-ink-500">
            {skipped ? "skipped" : step.kind === "model" ? "model call" : "free"}
          </span>
          {!skipped && step.ms > 0 && (
            <span className="font-mono text-[10px] text-ink-500">{step.ms}ms</span>
          )}
        </div>
        <p
          className={`mt-0.5 text-[12px] leading-relaxed ${
            rejected
              ? "font-medium text-rose-500"
              : unchecked
                ? "text-amber-600"
                : "text-ink-400"
          }`}
        >
          {step.summary}
        </p>
        {step.skipped && (
          <p className="mt-0.5 text-[11px] text-ink-500">└ {step.skipped}</p>
        )}
      </div>
      {rejected && <X className="mt-0.5 size-3.5 shrink-0 text-rose-500" />}
      {!skipped && !rejected && !unchecked && step.kind === "model" && (
        <Check className="mt-0.5 size-3.5 shrink-0 text-signal-deep" />
      )}
    </li>
  );
}
