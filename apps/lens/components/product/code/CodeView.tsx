"use client";

/**
 * CodeView — the Proof tier, on screen at last.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Every other tab in LENS asks a model what it thinks is going on. This one
 * doesn't have to: the code runs, and the output either matches the expected
 * value or it doesn't. That verdict is arithmetic, not an opinion, and the
 * UI is built to make that visible — the PASS/FAIL banner and the
 * input/expected/actual row come from the run, and the hint underneath is
 * clearly a separate, lesser thing that only appears once the run has
 * already failed.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *
 *   - No "Show solution" button. There is no endpoint behind one, and the
 *     answer is never sent to this component. Someone reading the network
 *     tab during judging will find the problem, the starter code and the
 *     failing input, and no correct version of anything.
 *   - No hint on a passing run, and no hint before a run. The ladder is
 *     earned by attempts, and the server counts the attempts.
 *   - No syntax-highlighted editor library. A textarea with line numbers
 *     and a working Tab key is the whole requirement; CodeMirror would be
 *     ~200KB and a hydration risk for zero added capability here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookMarked,
  Check,
  ChevronDown,
  Code2,
  Cpu,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  Terminal,
  X,
} from "lucide-react";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";
import { Working } from "../Working";

type Problem = {
  id: string;
  problem: string;
  starterCode: string;
  language: "javascript";
  knownFailingInput: string;
};

type CheckResult = {
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  logs: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
};

type TraceStep = {
  step: string;
  kind: "deterministic" | "model";
  ms: number;
  modelCalls: number;
  summary: string;
  skipped?: string | null;
};

type Trace = {
  steps: TraceStep[];
  modelCalls: number;
  callsAvoided: number;
  verified: boolean | null;
  verifyNote: string | null;
  gated: boolean;
};

type Recalled = {
  belief: string;
  surface: string;
  occurrences: number;
  score: number;
};

type Citation = {
  title: string;
  kind: string;
  url: string | null;
  quote: string;
  score: number;
};

type CheckResponse = {
  check?: CheckResult;
  hint?: string | null;
  rung?: string | null;
  trace?: Trace;
  recalled?: Recalled[];
  citation?: Citation | null;
  error?: string;
};

/** How the ladder reads to a student, who has not read our contracts file. */
const RUNG_LABEL: Record<string, string> = {
  OBSERVE: "a look",
  POINT: "where to look",
  ASK: "a question",
  NUDGE: "the concept",
  EXPERIMENT: "something to try",
  EXPLAIN: "the idea, properly",
};

export function CodeView() {
  const sessionId = useLens((s) => s.sessionId);
  const pushToast = useLens((s) => s.pushToast);

  const [problems, setProblems] = useState<Problem[]>([]);
  const [active, setActive] = useState<Problem | null>(null);
  const [source, setSource] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [rung, setRung] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [recalled, setRecalled] = useState<Recalled[]>([]);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [picking, setPicking] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Read after mount: `navigator` does not exist while this renders on the
  // server, and guessing wrong here would be a hydration mismatch.
  const [modKey, setModKey] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setModKey("⌘");
  }, []);

  // ── Load the problem set ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/code/problems", { cache: "no-store" });
        const data = (await res.json()) as { problems?: Problem[]; error?: string };
        if (cancelled) return;
        const list = data.problems ?? [];
        setProblems(list);
        if (list.length) {
          setActive(list[0]);
          setSource(list[0].starterCode);
        }
      } catch {
        if (!cancelled) pushToast({ kind: "error", text: "Couldn't load the problems." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushToast]);

  const choose = useCallback((p: Problem) => {
    setActive(p);
    setSource(p.starterCode);
    setResult(null);
    setHint(null);
    setRung(null);
    setTrace(null);
    setRecalled([]);
    setCitation(null);
    setAttempts(0);
    setPicking(false);
  }, []);

  // ── Run ────────────────────────────────────────────────────────────
  const run = useCallback(async () => {
    if (!active || running || !source.trim()) return;
    setRunning(true);
    setHint(null);
    try {
      const res = await fetch("/api/code/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId: active.id, source, sessionId }),
      });
      const data = (await res.json()) as CheckResponse;

      if (!res.ok || !data.check) {
        pushToast({ kind: "error", text: data.error || "Couldn't run that." });
        return;
      }

      setResult(data.check);
      setHint(data.hint ?? null);
      setRung(data.rung ?? null);
      setTrace(data.trace ?? null);
      setRecalled(data.recalled ?? []);
      setCitation(data.citation ?? null);
      setAttempts((n) => n + 1);
    } catch {
      pushToast({ kind: "error", text: "Couldn't reach the runner." });
    } finally {
      setRunning(false);
    }
  }, [active, running, source, sessionId, pushToast]);

  // ── Editor behaviour ───────────────────────────────────────────────

  /** Tab indents instead of leaving the editor; Cmd/Ctrl+Enter runs. */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    const next = `${source.slice(0, start)}  ${source.slice(end)}`;
    setSource(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 2;
    });
  }

  /** Keep the line-number gutter locked to the textarea's scroll. */
  function onScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  }

  const lineCount = source.split("\n").length;

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-[13px] text-ink-500">
          {problems.length === 0 ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Loading problems…
            </>
          ) : (
            "Pick a problem to start."
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-1">
      {/* ── Problem header ─────────────────────────────────────────── */}
      <div className="rounded-3xl glass-panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-signal-deep">
              <Code2 className="size-3.5" />
              Debug it — the code runs, nothing is guessed
            </div>
            <p className="text-[15px] font-semibold leading-snug text-ink-100">
              {active.problem}
            </p>
            <p className="mt-1.5 font-mono text-[12px] text-ink-500">
              known to fail on{" "}
              <span className="rounded bg-white/60 px-1.5 py-0.5 text-ink-200">
                {active.knownFailingInput}
              </span>
            </p>
          </div>

          {/* Problem picker */}
          <div className="relative shrink-0">
            <button
              onClick={() => setPicking((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl border border-white/60 bg-white/50 px-3 py-2 text-[12px] font-medium text-ink-200 transition hover:bg-white/80"
            >
              {problems.findIndex((p) => p.id === active.id) + 1} / {problems.length}
              <ChevronDown className={cn("size-3.5 transition", picking && "rotate-180")} />
            </button>

            {picking && (
              <div className="absolute right-0 z-20 mt-2 max-h-80 w-80 overflow-y-auto rounded-2xl border border-white/60 bg-white/95 p-1.5 shadow-xl backdrop-blur">
                {problems.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => choose(p)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-[12px] transition",
                      p.id === active.id
                        ? "bg-signal/10 font-semibold text-signal-deep"
                        : "text-ink-300 hover:bg-ink-50/60"
                    )}
                  >
                    <span className="mt-px font-mono text-ink-500">{i + 1}</span>
                    <span className="leading-snug">{p.problem}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Editor ─────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-3xl glass-panel">
        <div className="flex items-center justify-between border-b border-white/50 px-4 py-2.5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-500">
            {active.language}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSource(active.starterCode);
                setResult(null);
                setHint(null);
              }}
              title="Back to the original buggy code"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-ink-500 transition hover:bg-white/60 hover:text-ink-200"
            >
              <RotateCcw className="size-3" />
              Reset
            </button>
            <button
              onClick={run}
              disabled={running}
              className="flex items-center gap-1.5 rounded-lg bg-signal px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-card transition hover:brightness-105 disabled:opacity-60"
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {running ? "Running" : "Run"}
            </button>
          </div>
        </div>

        <div className="flex max-h-[42vh] min-h-[220px]">
          {/* Line numbers. aria-hidden: the textarea is the real control. */}
          <div
            ref={gutterRef}
            aria-hidden
            className="select-none overflow-hidden border-r border-white/50 bg-white/30 px-3 py-3 text-right font-mono text-[12.5px] leading-[1.65] text-ink-500/70"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          <textarea
            ref={editorRef}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[12.5px] leading-[1.65] text-ink-100 outline-none"
          />
        </div>

        <div className="border-t border-white/50 px-4 py-2 text-[11px] text-ink-500">
          {running ? (
            <Working active set="council" />
          ) : (
            <>Tab indents · {modKey}+Enter runs</>
          )}
        </div>
      </div>

      {/* ── Verdict ────────────────────────────────────────────────── */}
      {result && (
        <div
          className={cn(
            "rounded-3xl border p-5",
            result.passed
              ? "border-emerald-200 bg-emerald-50/70"
              : "border-amber-200 bg-amber-50/60"
          )}
        >
          <div className="mb-3 flex items-center gap-2">
            {result.passed ? (
              <>
                <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500">
                  <Check className="size-3 text-white" />
                </span>
                <span className="text-[14px] font-bold text-emerald-900">
                  Passes on {result.input}
                </span>
              </>
            ) : (
              <>
                <span className="flex size-5 items-center justify-center rounded-full bg-amber-500">
                  <X className="size-3 text-white" />
                </span>
                <span className="text-[14px] font-bold text-amber-900">
                  Still wrong on {result.input}
                </span>
              </>
            )}
            <span className="ml-auto font-mono text-[11px] text-ink-500">{result.ms}ms</span>
          </div>

          {/* The evidence. This is the product's whole claim, so it is shown
              as data rather than described in a sentence. */}
          <div className="grid grid-cols-3 gap-2 font-mono text-[12px]">
            {[
              ["input", result.input, "text-ink-200"],
              ["expected", result.expected, "text-emerald-700"],
              [
                "got",
                result.stderr ? "error" : result.actual || "(nothing)",
                result.passed ? "text-emerald-700" : "text-amber-800",
              ],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-xl bg-white/70 px-3 py-2">
                <div className="mb-0.5 text-[10px] uppercase tracking-wider text-ink-500">
                  {label}
                </div>
                <div className={cn("truncate font-semibold", tone)} title={String(value)}>
                  {String(value)}
                </div>
              </div>
            ))}
          </div>

          {result.stderr && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2.5">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-600" />
              <p className="font-mono text-[11.5px] leading-relaxed text-amber-900">
                {result.stderr}
              </p>
            </div>
          )}

          {/* Their own console.log output, kept separate from the answer so
              debugging by printing never costs them a correct run. */}
          {result.logs && (
            <div className="mt-3 rounded-xl bg-ink-950/90 px-3 py-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/50">
                <Terminal className="size-3" />
                your output
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-emerald-300">
                {result.logs}
              </pre>
            </div>
          )}

          {/* ── The hint, only ever after a real failure ───────────── */}
          {!result.passed && hint && (
            <div className="mt-3 rounded-2xl border border-signal/25 bg-white/80 p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="rounded-full bg-signal/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-signal-deep">
                  {rung ? RUNG_LABEL[rung] ?? rung.toLowerCase() : "hint"}
                </span>
                <span className="text-[11px] text-ink-500">
                  attempt {attempts} — this is as much as you&apos;ve earned
                </span>
              </div>
              <p className="text-[13.5px] leading-relaxed text-ink-200">{hint}</p>

              {citation && (
                <div className="mt-3 border-l-2 border-signal/40 pl-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-signal-deep">
                    <BookMarked className="size-3" />
                    from your own {citation.kind}
                  </div>
                  <p className="text-[12px] italic leading-relaxed text-ink-300">
                    &ldquo;{citation.quote}&rdquo;
                  </p>
                  <p className="mt-1 text-[11px] text-ink-500">
                    {citation.url ? (
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-ink-500/40 underline-offset-2 hover:text-ink-300"
                      >
                        {citation.title}
                      </a>
                    ) : (
                      citation.title
                    )}{" "}
                    <span className="font-mono">{citation.score.toFixed(2)}</span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* A hint the auditor threw out. This is worth showing, not
              hiding: it is the product's promise being enforced rather
              than asserted. */}
          {!result.passed && !hint && trace?.verified === false && (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <ShieldAlert className="size-3.5 text-rose-600" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700">
                  hint rejected
                </span>
              </div>
              <p className="text-[12.5px] leading-relaxed text-rose-900">
                LENS wrote you a hint and a second model threw it out for giving
                away the fix{trace.verifyNote ? ` — ${trace.verifyNote.toLowerCase()}` : ""}.
                You get the failing case instead.
              </p>
            </div>
          )}

          {!result.passed && !hint && trace?.verified !== false && (
            <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
              The failing case above is the hint. Run it in your head on{" "}
              <span className="font-mono">{result.input}</span> and watch where it
              diverges.
            </p>
          )}

          {/* ── What the agents did ─────────────────────────────────── */}
          {trace && trace.steps.length > 0 && (
            <details className="mt-3 rounded-2xl bg-white/60 px-4 py-3">
              <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                <Cpu className="size-3.5" />
                what LENS did
                <span className="ml-auto font-normal normal-case tracking-normal">
                  {trace.modelCalls} model call{trace.modelCalls === 1 ? "" : "s"}
                  {trace.callsAvoided > 0 && (
                    <span className="text-signal-deep"> · {trace.callsAvoided} skipped</span>
                  )}
                </span>
              </summary>

              <div className="mt-3 flex flex-col gap-1.5">
                {trace.steps.map((st, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[11.5px]">
                    <span
                      className={cn(
                        "w-[4.5rem] shrink-0 font-mono font-semibold",
                        st.skipped ? "text-ink-500/60" : "text-ink-200"
                      )}
                    >
                      {st.step}
                    </span>
                    <span
                      className={cn(
                        "flex-1 leading-snug",
                        st.skipped ? "text-ink-500/70" : "text-ink-300"
                      )}
                    >
                      {st.skipped ?? st.summary}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-500/60">
                      {st.kind === "deterministic" ? "free" : `${st.modelCalls}×`}
                      {st.ms > 0 ? ` ${st.ms}ms` : ""}
                    </span>
                  </div>
                ))}
              </div>

              {recalled.length > 0 && (
                <div className="mt-3 border-t border-white/70 pt-2.5">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
                    recalled about you
                  </div>
                  {recalled.map((m, i) => (
                    <p key={i} className="text-[11.5px] leading-snug text-ink-300">
                      <span className="font-mono text-ink-500">
                        {m.score.toFixed(2)}
                      </span>{" "}
                      {m.belief}{" "}
                      <span className="text-ink-500">
                        ({m.surface}, {m.occurrences}×)
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </details>
          )}

          {result.passed && (
            <p className="mt-3 text-[12.5px] leading-relaxed text-emerald-900">
              You found it yourself. Nothing here told you the answer.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
