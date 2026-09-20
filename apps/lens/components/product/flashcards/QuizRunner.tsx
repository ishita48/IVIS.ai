"use client";

/**
 * QuizRunner — one question at a time, answered, explained, then scored.
 *
 * Committing to an answer is irreversible: the choice locks, the result
 * lands immediately, and the explanation appears. That is deliberate. A
 * quiz you can change your mind on after seeing the mark measures nothing,
 * and the whole value of the end-of-quiz report is that the numbers in it
 * are honest.
 *
 * Grading is client-side (see QuizQuestion in contracts for why). The
 * answer is written to the event log either way, so the report and the
 * library's per-question history are queries over real attempts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookmarkCheck,
  BookmarkPlus,
  Check,
  Quote,
  RotateCcw,
  X,
} from "lucide-react";
import { useLens } from "@/lib/store";
import type { QuizQuestion } from "@/lib/lens/contracts";

type Answer = {
  questionId: string;
  topic: string;
  sourceTitle: string;
  chosen: number;
  correct: boolean;
  ms: number;
};

const LETTER = ["A", "B", "C", "D", "E", "F"];

export function QuizRunner({
  questions,
  title,
}: {
  questions: QuizQuestion[];
  title?: string;
}) {
  const sessionId = useLens((s) => s.sessionId);

  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());

  const current = questions[index] ?? null;
  const done = index >= questions.length && questions.length > 0;

  const reset = useCallback(() => {
    setIndex(0);
    setChosen(null);
    setAnswers([]);
    setStartedAt(Date.now());
  }, []);

  useEffect(() => {
    reset();
  }, [questions, reset]);

  // Which questions are already saved, so the bookmark starts correct.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/study-library?kind=question", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: { id: string }[] };
        if (cancelled) return;
        setSaved(new Set((data.items ?? []).map((q) => q.id)));
      } catch {
        /* the bookmark just starts empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = useCallback(
    (choice: number) => {
      if (!current || chosen !== null) return;

      const correct = choice === current.correctIndex;
      const ms = Date.now() - startedAt;
      setChosen(choice);
      setAnswers((prev) => [
        ...prev,
        {
          questionId: current.id,
          topic: current.topic,
          sourceTitle: current.sourceTitle,
          chosen: choice,
          correct,
          ms,
        },
      ]);

      // Fire-and-forget: a failed write must not interrupt a quiz.
      void fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "quiz_answered",
          sessionId,
          concept: current.topic,
          payload: {
            itemId: current.id,
            correct,
            chosenIndex: choice,
            correctIndex: current.correctIndex,
            ms,
            topic: current.topic,
            sourceTitle: current.sourceTitle,
          },
        }),
      }).catch(() => undefined);

      // A wrong choice is a belief the student just committed to, stated in
      // words. That is exactly what mistake memory stores — so the same
      // misconception caught here can be recognised later on the camera.
      if (!correct) {
        void fetch("/api/mistakes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId,
            surface: "quiz",
            concept: current.topic,
            belief: current.choices[choice],
            rootCause: current.explanation,
            evidence: `Chose "${current.choices[choice]}" for "${current.prompt}"`,
            sourceTitle: current.sourceTitle,
          }),
        }).catch(() => undefined);
      }
    },
    [current, chosen, sessionId, startedAt]
  );

  const next = useCallback(() => {
    setChosen(null);
    setStartedAt(Date.now());
    setIndex((i) => i + 1);
  }, []);

  const toggleSave = useCallback(async () => {
    if (!current) return;
    const isSaved = saved.has(current.id);
    setSavingId(current.id);
    try {
      if (isSaved) {
        await fetch(
          `/api/study-library?kind=question&id=${encodeURIComponent(current.id)}`,
          { method: "DELETE" }
        );
        setSaved((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(current.id);
          return nextSet;
        });
      } else {
        await fetch("/api/study-library", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "question", item: current, sessionId }),
        });
        setSaved((prev) => new Set(prev).add(current.id));
      }
    } catch {
      /* leave the bookmark as it was */
    } finally {
      setSavingId(null);
    }
  }, [current, saved, sessionId]);

  // Keyboard: letters pick, Enter advances.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (!current) return;

      if (chosen === null) {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= current.choices.length) {
          e.preventDefault();
          commit(n - 1);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, chosen, commit, next]);

  if (done) return <QuizReport answers={answers} onRestart={reset} />;
  if (!current) return null;

  const isSaved = saved.has(current.id);
  const answered = chosen !== null;

  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-500">
        <span>
          {title ? `${title} · ` : ""}Question {index + 1} of {questions.length}
        </span>
        <span className="hidden sm:block">
          {answered ? "enter for the next one" : "press 1–4 to answer"}
        </span>
      </div>

      <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-ink-800/15">
        <div
          className="h-full rounded-full bg-signal transition-all duration-500"
          style={{ width: `${(index / questions.length) * 100}%` }}
        />
      </div>

      <section className="rounded-2xl border border-ink-800/15 bg-white/60 p-6 shadow-card">
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="rounded-full bg-signal/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-signal-deep">
            {current.topic} · {current.difficulty}
          </span>
          <button
            type="button"
            onClick={() => void toggleSave()}
            disabled={savingId === current.id}
            aria-pressed={isSaved}
            title={isSaved ? "Remove from library" : "Save to library"}
            className={`shrink-0 rounded-full p-1.5 transition disabled:opacity-40 ${
              isSaved ? "text-signal-deep" : "text-ink-500 hover:text-ink-200"
            }`}
          >
            {isSaved ? (
              <BookmarkCheck className="size-4" />
            ) : (
              <BookmarkPlus className="size-4" />
            )}
          </button>
        </div>

        <h3 className="text-[17px] font-semibold leading-snug text-ink-100">
          {current.prompt}
        </h3>

        <div className="mt-4 grid gap-2">
          {current.choices.map((choice, i) => {
            const isCorrect = i === current.correctIndex;
            const isChosen = i === chosen;

            let style =
              "border-ink-800/15 bg-white/40 text-ink-300 hover:border-signal/40 hover:bg-white/70";
            if (answered && isCorrect) {
              style = "border-signal/50 bg-signal/10 text-signal-deep";
            } else if (answered && isChosen) {
              style = "border-rose-400/50 bg-rose-500/10 text-rose-400";
            } else if (answered) {
              style = "border-ink-800/10 bg-white/20 text-ink-500";
            }

            return (
              <button
                key={i}
                onClick={() => commit(i)}
                disabled={answered}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-[13px] transition disabled:cursor-default ${style}`}
              >
                <span className="mt-px shrink-0 text-[11px] font-semibold opacity-60">
                  {LETTER[i]}
                </span>
                <span className="flex-1">{choice}</span>
                {answered && isCorrect && <Check className="mt-px size-4 shrink-0" />}
                {answered && isChosen && !isCorrect && (
                  <X className="mt-px size-4 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="mt-5 border-t border-ink-800/10 pt-4">
            <p
              className={`text-[13px] font-semibold ${
                chosen === current.correctIndex ? "text-signal-deep" : "text-rose-400"
              }`}
            >
              {chosen === current.correctIndex ? "Correct." : "Not this time."}
            </p>
            {current.explanation && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-300">
                {current.explanation}
              </p>
            )}

            <p className="mt-3 text-[10px] uppercase tracking-wider text-ink-500">
              From {current.sourceTitle}
            </p>
            {current.sourceQuote ? (
              <p className="mt-1.5 flex gap-2 text-[12px] italic leading-relaxed text-ink-400">
                <Quote className="mt-0.5 size-3 shrink-0 text-signal-deep" />
                <span>“{current.sourceQuote}”</span>
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] text-ink-500">
                No verbatim sentence in that source backed this closely enough to
                quote.
              </p>
            )}

            <button
              onClick={next}
              className="mt-4 w-full rounded-xl bg-signal px-4 py-3 text-[13px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white"
            >
              {index + 1 === questions.length ? "See your results" : "Next question"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The report. Accuracy, pace, and the topics that actually cost marks —
 * grouped, because "you missed questions 2, 5 and 9" is not actionable.
 */
function QuizReport({
  answers,
  onRestart,
}: {
  answers: Answer[];
  onRestart: () => void;
}) {
  const correct = answers.filter((a) => a.correct).length;
  const pct = answers.length ? Math.round((correct / answers.length) * 100) : 0;
  const totalMs = answers.reduce((sum, a) => sum + a.ms, 0);
  const avgSec = answers.length ? totalMs / answers.length / 1000 : 0;

  const byTopic = useMemo(() => {
    const map = new Map<string, { wrong: number; total: number; source: string }>();
    for (const a of answers) {
      const row = map.get(a.topic) ?? { wrong: 0, total: 0, source: a.sourceTitle };
      row.total += 1;
      if (!a.correct) row.wrong += 1;
      map.set(a.topic, row);
    }
    return map;
  }, [answers]);

  const toRevisit = Array.from(byTopic.entries())
    .filter(([, row]) => row.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong);

  const strongest = Array.from(byTopic.entries())
    .filter(([, row]) => row.wrong === 0)
    .map(([topic]) => topic);

  return (
    <section className="mt-5 rounded-2xl border border-ink-800/15 bg-white/60 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-signal-deep">
            Quiz complete
          </p>
          <h3 className="mt-1 text-[28px] font-semibold leading-none text-ink-100">
            {correct}/{answers.length}
          </h3>
          <p className="mt-1.5 text-[12px] text-ink-500">
            {pct}% correct · {avgSec.toFixed(1)}s per question ·{" "}
            {Math.round(totalMs / 1000)}s total
          </p>
        </div>
        <button
          onClick={onRestart}
          className="flex items-center gap-2 rounded-xl border border-ink-800/15 px-4 py-2 text-[12px] font-medium text-ink-300 transition hover:border-signal/40 hover:text-ink-100"
        >
          <RotateCcw className="size-3.5" />
          Retake
        </button>
      </div>

      <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-ink-800/10">
        {correct > 0 && <div className="bg-signal" style={{ flex: correct }} />}
        {answers.length - correct > 0 && (
          <div className="bg-rose-400" style={{ flex: answers.length - correct }} />
        )}
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
            What to go back to
          </h4>
          {toRevisit.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-400">
              Nothing — you got every question right.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {toRevisit.map(([topic, row]) => (
                <li
                  key={topic}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-signal/[0.06] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink-200">{topic}</p>
                    <p className="mt-0.5 text-[11px] text-ink-500">in {row.source}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-500">
                    {row.wrong} of {row.total} wrong
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
            Solid
          </h4>
          {strongest.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-400">
              No topic came through clean this time.
            </p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {strongest.map((topic) => (
                <li
                  key={topic}
                  className="rounded-full bg-ink-800/[0.06] px-3 py-1.5 text-[12px] text-ink-300"
                >
                  {topic}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
