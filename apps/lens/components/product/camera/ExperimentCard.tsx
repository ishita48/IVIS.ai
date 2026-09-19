"use client";

/**
 * ExperimentCard — predict, act, then find out. (P1 — Proof tier)
 * ─────────────────────────────────────────────────────────────────────
 * The prediction step is the point. A student who commits to an outcome
 * before acting learns from the result; a student who just watches it
 * happen does not. So the "run it" control stays disabled until they have
 * predicted.
 */

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import type { Experiment } from "@/lib/lens/contracts";
import { cn } from "@/lib/cn";

export function ExperimentCard({
  experiment,
  onResult,
}: {
  experiment: Experiment;
  onResult: (studentPrediction: string, actualOutcome: string) => Promise<void>;
}) {
  const [prediction, setPrediction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  const predicted = prediction.trim().length > 0;

  return (
    <div className="rounded-2xl border border-ink-800/15 bg-white/60 p-4 backdrop-blur">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-deep">
        <FlaskConical className="size-3.5" />
        Experiment
      </div>

      <p className="mb-3 text-[14px] font-medium text-ink-100">
        {experiment.hypothesis}
      </p>

      <ol className="mb-3 space-y-1 text-[13px] text-ink-400">
        {experiment.steps.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-signal-deep">{i + 1}.</span>
            {s}
          </li>
        ))}
      </ol>

      <label className="mb-1 block text-[12px] font-medium text-ink-200">
        {experiment.predictionQuestion}
      </label>
      <input
        value={prediction}
        onChange={(e) => setPrediction(e.target.value)}
        placeholder="What do you think will happen?"
        className="mb-3 w-full rounded-xl border border-ink-800/15 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-signal/50"
      />

      <label
        className={cn(
          "mb-1 block text-[12px] font-medium transition",
          predicted ? "text-ink-200" : "text-ink-500"
        )}
      >
        What actually happened?
      </label>
      <input
        value={outcome}
        disabled={!predicted}
        onChange={(e) => setOutcome(e.target.value)}
        placeholder={predicted ? "Run it, then tell me" : "Predict first"}
        className="mb-3 w-full rounded-xl border border-ink-800/15 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-signal/50 disabled:opacity-50"
      />

      <button
        disabled={!predicted || !outcome.trim() || busy}
        onClick={async () => {
          setBusy(true);
          await onResult(prediction.trim(), outcome.trim());
          setBusy(false);
        }}
        className="w-full rounded-xl bg-signal px-3 py-2 text-[13px] font-medium text-ink-950 transition hover:bg-signal-deep hover:text-white disabled:opacity-40"
      >
        {busy ? "Recording…" : "Record the result"}
      </button>

      <p className="mt-2 text-[11px] text-ink-500">
        {experiment.reflectionQuestion}
      </p>
    </div>
  );
}
