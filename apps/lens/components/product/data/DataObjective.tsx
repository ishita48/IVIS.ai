"use client";

/**
 * DataObjective — predict, run a real query, read the ladder.
 * ─────────────────────────────────────────────────────────────────────
 * Same pedagogy as the gear train: commit before the number exists.
 * ExperimentCard owns the prediction step; POST /api/datasets/run runs
 * the committed slice and returns the reasoning state to render.
 */

import { useEffect, useMemo, useState } from "react";
import { CircleDashed, Database, Loader2 } from "lucide-react";
import { ExperimentCard } from "@/components/product/camera/ExperimentCard";
import { cn } from "@/lib/cn";
import type { DatasetSummary } from "@/lib/datasets";
import { HINT_LADDER, type Experiment, type ReasoningState } from "@/lib/lens/contracts";
import { useLens } from "@/lib/store";

type RunResponse = {
  sessionId: string;
  prediction: string;
  answer: string;
  reasoning:
    | { skipped: "not_in_notes" }
    | { state: ReasoningState; outcome: string };
  referenceImageUrl: string | null;
};

export function DataObjective() {
  const sessionId = useLens((s) => s.sessionId);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<string>("");
  const [questionId, setQuestionId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      setListError(null);
      try {
        const res = await fetch("/api/datasets");
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        const body = (await res.json()) as { datasets: DatasetSummary[] };
        if (cancelled) return;
        setDatasets(body.datasets || []);
        const first = body.datasets?.[0];
        if (first) {
          setDatasetId(first.id);
          setQuestionId(first.questions[0]?.id || "");
        }
      } catch (error) {
        if (!cancelled) {
          setListError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dataset = datasets.find((d) => d.id === datasetId) ?? null;
  const question = dataset?.questions.find((q) => q.id === questionId) ?? null;

  const experiment: Experiment | null = useMemo(() => {
    if (!dataset || !question) return null;
    return {
      sessionId: sessionId || "pending",
      concept: `${dataset.id}:${question.id}`,
      hypothesis: question.prompt,
      steps: [
        "Write the prediction you believe before any number exists.",
        "Type run in the outcome box to execute the query on the committed slice.",
        "LENS returns the real answer and the ladder for your prediction.",
      ],
      predictionQuestion: question.predictionQuestion,
      reflectionQuestion: "Does the result match what you expected, and why?",
      status: "pending",
    };
  }, [dataset, question, sessionId]);

  async function onResult(studentPrediction: string, _actualOutcome: string) {
    if (!dataset || !question) return;
    setBusy(true);
    setRunError(null);
    setResult(null);
    try {
      const res = await fetch("/api/datasets/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          datasetId: dataset.id,
          questionId: question.id,
          prediction: studentPrediction,
          sessionId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setResult(body as RunResponse);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const state =
    result?.reasoning && "state" in result.reasoning ? result.reasoning.state : null;

  return (
    <div className="flex h-full min-h-0 gap-3 overflow-hidden p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-slim">
        <div className="flex shrink-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          <Database className="size-3.5" />
          Data objective
        </div>

        {loadingList && (
          <div className="flex items-center gap-2 text-[13px] text-ink-500">
            <Loader2 className="size-3.5 animate-spin" />
            Loading datasets…
          </div>
        )}
        {listError && <p className="text-[13px] text-rose-600">{listError}</p>}

        {!loadingList && datasets.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[12px] font-medium text-ink-200">
              Dataset
              <select
                value={datasetId}
                onChange={(e) => {
                  const next = e.target.value;
                  setDatasetId(next);
                  const found = datasets.find((d) => d.id === next);
                  setQuestionId(found?.questions[0]?.id || "");
                  setResult(null);
                }}
                className="mt-1 w-full rounded-xl border border-ink-800/15 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-signal/50"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] font-medium text-ink-200">
              Question
              <select
                value={questionId}
                onChange={(e) => {
                  setQuestionId(e.target.value);
                  setResult(null);
                }}
                className="mt-1 w-full rounded-xl border border-ink-800/15 bg-white/70 px-3 py-2 text-[13px] outline-none focus:border-signal/50"
              >
                {(dataset?.questions || []).map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.prompt}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {dataset?.insight && (
          <p className="text-[12px] leading-relaxed text-ink-500">{dataset.insight}</p>
        )}

        {experiment && (
          <div className={cn(busy && "pointer-events-none opacity-70")}>
            <ExperimentCard experiment={experiment} onResult={onResult} />
          </div>
        )}

        {runError && <p className="text-[13px] text-rose-600">{runError}</p>}

        {result && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-ink-800/15 bg-white/60 p-4 backdrop-blur">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-deep">
                Query result
              </div>
              <p className="text-[13px] text-ink-200">
                <span className="text-ink-500">You predicted: </span>
                {result.prediction}
              </p>
              <p className="mt-2 text-[14px] font-medium text-ink-100">{result.answer}</p>
              {result.referenceImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.referenceImageUrl}
                  alt="Reference chart of the true answer"
                  className="mt-3 max-h-64 w-full rounded-xl object-contain"
                />
              )}
            </div>

            {state ? (
              <ReasoningStateCard state={state} />
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-ink-800/15 bg-white/40 px-6 py-8 text-center">
                <CircleDashed className="size-8 text-ink-600" />
                <p className="max-w-sm text-[13px] text-ink-500">
                  {result.reasoning && "skipped" in result.reasoning
                    ? "No ladder for this prediction — try a wrong answer the question is built to catch."
                    : "No reasoning state returned for this run."}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Same card markup ReasoningGraph uses for one persisted state. */
function ReasoningStateCard({ state }: { state: ReasoningState }) {
  return (
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

      {state.probableBelief && (
        <div className="mt-2 text-[11px] text-ink-500">
          {Math.round(state.confidence * 100)}% likely
        </div>
      )}
    </div>
  );
}

function LadderPip({ level }: { level: string }) {
  const idx = HINT_LADDER.indexOf(level as (typeof HINT_LADDER)[number]);
  return (
    <span className="flex items-center gap-1" title={`Hint ladder: ${level}`}>
      {HINT_LADDER.map((l, i) => (
        <span
          key={l}
          className={cn("size-1.5 rounded-full", i <= idx ? "bg-signal" : "bg-ink-800/20")}
        />
      ))}
    </span>
  );
}

