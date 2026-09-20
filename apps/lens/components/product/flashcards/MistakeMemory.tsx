"use client";

/**
 * MistakeMemory — the beliefs this student keeps returning to.
 *
 * This is the one screen that shows what the event log is actually for.
 * Everything on it is a vector query over Elastic: the list is the
 * student's belief history ranked by how often each one has recurred, and
 * the search box runs a live kNN lookup so you can watch a rephrased
 * question find the belief it matches.
 *
 * The similarity score is on screen on purpose. A memory feature that just
 * asserts "you've seen this before" is unfalsifiable; one that shows 0.81
 * and lets you type a different sentence and watch the number move is a
 * claim someone can check.
 */

import { useCallback, useEffect, useState } from "react";
import { Brain, Check, Loader2, Search } from "lucide-react";
import { Working } from "../Working";

type Mistake = {
  _id: string;
  surface: string;
  concept: string;
  belief: string;
  rootCause: string;
  evidence: string;
  sourceTitle?: string | null;
  resolved: boolean;
  occurrences: number;
  firstSeenAt: string;
  score?: number;
};

const SURFACE_LABEL: Record<string, string> = {
  camera: "camera",
  quiz: "quiz",
  flashcards: "flashcards",
  guide: "guide",
  reasoning: "tutor",
};

export function MistakeMemory() {
  const [mistakes, setMistakes] = useState<Mistake[] | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"list" | "recall">("list");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q?: string) => {
    setBusy(true);
    setError(null);
    try {
      const url = q?.trim()
        ? `/api/mistakes?q=${encodeURIComponent(q.trim())}&k=6`
        : "/api/mistakes";
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        mistakes?: Mistake[];
        mode?: "list" | "recall";
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not read mistake memory.");
      setMistakes(data.mistakes ?? []);
      setMode(data.mode ?? "list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read mistake memory.");
      setMistakes([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (id: string) => {
    setMistakes((prev) =>
      prev?.map((m) => (m._id === id ? { ...m, resolved: true } : m)) ?? prev
    );
    try {
      await fetch("/api/mistakes", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      void load(query);
    }
  };

  const recurring = (mistakes ?? []).filter((m) => m.occurrences > 1).length;

  return (
    <div className="mt-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[14px] font-medium text-ink-100">
            <Brain className="size-4 text-signal-deep" />
            Belief history
          </p>
          <p className="mt-1 text-[12px] text-ink-500">
            Every misconception LENS has seen, from any surface, matched by meaning
            rather than wording. Vector search over Elastic.
          </p>
        </div>
        {mistakes && mistakes.length > 0 && (
          <p className="text-[11px] text-ink-500">
            {mistakes.length} belief{mistakes.length === 1 ? "" : "s"}
            {recurring > 0 && ` · ${recurring} recurring`}
          </p>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(query);
            }}
            placeholder="Describe what's happening now — “put the diode in backwards again”"
            className="w-full rounded-xl border border-ink-800/15 bg-white/60 py-2 pl-9 pr-3 text-[13px] outline-none focus:border-signal/50"
          />
        </div>
        <button
          onClick={() => void load(query)}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-signal px-4 py-2 text-[12px] font-semibold text-ink-950 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Brain className="size-4" />}
          Recall
        </button>
        {mode === "recall" && (
          <button
            onClick={() => {
              setQuery("");
              void load();
            }}
            className="rounded-xl border border-ink-800/15 px-3 py-2 text-[12px] text-ink-400 transition hover:text-ink-100"
          >
            Show all
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-rose-300/40 bg-rose-50/60 p-3 text-[12px] text-rose-700">
          {error}
        </div>
      )}

      {mistakes === null ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-ink-800/15 p-10">
          <Working active set="recall" />
        </div>
      ) : mistakes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-800/15 p-10 text-center text-[13px] text-ink-500">
          {mode === "recall"
            ? "Nothing close enough to that to be worth mentioning."
            : "No beliefs recorded yet. Work through a session, a quiz, or a deck and they collect here."}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {mistakes.map((m) => (
            <li
              key={m._id}
              className={`rounded-2xl border p-4 ${
                m.resolved
                  ? "border-ink-800/10 bg-white/30 opacity-60"
                  : m.occurrences > 1
                    ? "border-amber-400/30 bg-amber-500/[0.06]"
                    : "border-ink-800/15 bg-white/60"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {m.occurrences > 1 && (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    seen {m.occurrences}×
                  </span>
                )}
                <span className="rounded-full bg-signal/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-signal-deep">
                  {SURFACE_LABEL[m.surface] ?? m.surface}
                </span>
                {typeof m.score === "number" && (
                  <span className="font-mono text-[10px] text-ink-500">
                    similarity {m.score.toFixed(2)}
                  </span>
                )}
                <span className="text-[10px] text-ink-500">
                  first seen{" "}
                  {new Date(m.firstSeenAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {!m.resolved && (
                  <button
                    onClick={() => void resolve(m._id)}
                    title="Mark this belief as resolved"
                    className="ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-ink-500 transition hover:text-signal-deep"
                  >
                    <Check className="size-3" />
                    resolved
                  </button>
                )}
              </div>

              <p className="text-[14px] font-medium leading-snug text-ink-100">
                “{m.belief}”
              </p>
              {m.rootCause && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-400">
                  Actually: {m.rootCause}
                </p>
              )}
              {(m.evidence || m.sourceTitle) && (
                <p className="mt-2 border-t border-ink-800/10 pt-2 text-[10px] text-ink-500">
                  {m.evidence}
                  {m.sourceTitle ? ` · ${m.sourceTitle}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
