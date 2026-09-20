"use client";

/**
 * FlashcardDeck — one card at a time, flipped, graded, and requeued.
 *
 * The grading is three-way on purpose (see CardGrade in contracts). A card
 * graded "Got it" graduates; "Kind of" and "Not yet" go back into the queue
 * a few cards later, so the round ends only when every card has been known
 * once. That is the whole spaced-repetition model — deliberately in-session
 * and deliberately simple, because a scheduler the student cannot see is
 * indistinguishable from a random shuffle over a fifteen-minute demo.
 *
 * The score at the end is FIRST-ATTEMPT accuracy, not final. Everything
 * ends at 100% once you keep going, so "how many did you know on sight"
 * is the only number that means anything.
 *
 * Every grade is also written to the event log, which is what lets a later
 * deck open on the cards this student has historically missed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkCheck,
  BookmarkPlus,
  Quote,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { useLens } from "@/lib/store";
import {
  GRADE_LABEL,
  REQUEUE_GAP,
  type CardGrade,
  type Flashcard,
} from "@/lib/lens/contracts";

type Attempt = { cardId: string; topic: string; grade: CardGrade; first: boolean };

const GRADE_ORDER: CardGrade[] = ["unknown", "partial", "known"];

const GRADE_STYLE: Record<CardGrade, string> = {
  unknown: "border-rose-400/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20",
  partial: "border-amber-400/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20",
  known: "border-signal/40 bg-signal/10 text-signal-deep hover:bg-signal/20",
};

export function FlashcardDeck({ cards }: { cards: Flashcard[] }) {
  const sessionId = useLens((s) => s.sessionId);

  // The working queue. Cards are appended back in when graded below "known".
  const [queue, setQueue] = useState<string[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const byId = useMemo(() => {
    const map = new Map<string, Flashcard>();
    for (const card of cards) map.set(card.id, card);
    return map;
  }, [cards]);

  const reset = useCallback(() => {
    setQueue(cards.map((c) => c.id));
    setFlipped(false);
    setAttempts([]);
    seen.current = new Set();
  }, [cards]);

  useEffect(() => {
    reset();
  }, [reset]);

  // Which cards are already in the library, so the bookmark starts correct.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/study-library?kind=card", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: { id: string }[] };
        if (cancelled) return;
        setSaved(new Set((data.items ?? []).map((c) => c.id)));
      } catch {
        /* the bookmark just starts empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = queue.length ? byId.get(queue[0]) ?? null : null;
  const done = queue.length === 0 && attempts.length > 0;

  const grade = useCallback(
    (value: CardGrade) => {
      if (!current) return;

      const first = !seen.current.has(current.id);
      seen.current.add(current.id);

      setAttempts((prev) => [
        ...prev,
        { cardId: current.id, topic: current.topic, grade: value, first },
      ]);

      // Fire-and-forget: a failed write must not interrupt a study round.
      void fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "flashcard_reviewed",
          sessionId,
          concept: current.topic,
          payload: {
            itemId: current.id,
            grade: value,
            correct: value === "known",
            firstAttempt: first,
            topic: current.topic,
            sourceTitle: current.sourceTitle,
          },
        }),
      }).catch(() => undefined);

      // Only the hard fail. "Kind of" is too weak a signal to call a belief.
      if (value === "unknown") {
        void fetch("/api/mistakes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId,
            surface: "flashcards",
            concept: current.topic,
            belief: `Could not recall: ${current.front}`,
            rootCause: current.back,
            evidence: `Graded "not yet" on a card about ${current.topic}`,
            sourceTitle: current.sourceTitle,
          }),
        }).catch(() => undefined);
      }

      setQueue((prev) => {
        const [head, ...rest] = prev;
        const gap = REQUEUE_GAP[value];
        if (gap === 0) return rest;
        // Slot it back `gap` cards later, or at the end if the queue is short.
        const at = Math.min(gap, rest.length);
        return [...rest.slice(0, at), head, ...rest.slice(at)];
      });

      setFlipped(false);
    },
    [current, sessionId]
  );

  const toggleSave = useCallback(async () => {
    if (!current) return;
    const isSaved = saved.has(current.id);
    setSavingId(current.id);
    try {
      if (isSaved) {
        await fetch(
          `/api/study-library?kind=card&id=${encodeURIComponent(current.id)}`,
          { method: "DELETE" }
        );
        setSaved((prev) => {
          const next = new Set(prev);
          next.delete(current.id);
          return next;
        });
      } else {
        await fetch("/api/study-library", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "card", item: current, sessionId }),
        });
        setSaved((prev) => new Set(prev).add(current.id));
      }
    } catch {
      /* leave the bookmark as it was */
    } finally {
      setSavingId(null);
    }
  }, [current, saved, sessionId]);

  // Keyboard: space flips, 1/2/3 grade. Study tools are a keyboard surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (!current) return;

      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && ["Digit1", "Digit2", "Digit3"].includes(e.code)) {
        e.preventDefault();
        grade(GRADE_ORDER[Number(e.code.slice(-1)) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, flipped, grade]);

  if (done) return <DeckReport attempts={attempts} cards={cards} onRestart={reset} />;
  if (!current) return null;

  const isSaved = saved.has(current.id);
  const remaining = queue.length;
  const graduated = cards.length - new Set(queue).size;

  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-500">
        <span>
          {graduated} of {cards.length} known · {remaining} left in the round
        </span>
        <span className="hidden sm:block">
          space to flip · 1 not yet · 2 kind of · 3 got it
        </span>
      </div>

      <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-ink-800/15">
        <div
          className="h-full rounded-full bg-signal transition-all duration-500"
          style={{ width: `${(graduated / Math.max(1, cards.length)) * 100}%` }}
        />
      </div>

      <div className="flip-scene">
        <div
          role="button"
          tabIndex={0}
          aria-label={flipped ? "Show the question" : "Show the answer"}
          onClick={() => setFlipped((f) => !f)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setFlipped((f) => !f);
            }
          }}
          className={`flip-card cursor-pointer ${flipped ? "is-flipped" : ""}`}
        >
          <CardFace
            card={current}
            side="front"
            isSaved={isSaved}
            saving={savingId === current.id}
            onToggleSave={toggleSave}
          />
          <CardFace
            card={current}
            side="back"
            isSaved={isSaved}
            saving={savingId === current.id}
            onToggleSave={toggleSave}
          />
        </div>
      </div>

      <div className="mt-4">
        {flipped ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {GRADE_ORDER.map((value, index) => (
              <button
                key={value}
                onClick={() => grade(value)}
                className={`rounded-xl border px-4 py-3 text-[13px] font-semibold transition ${GRADE_STYLE[value]}`}
              >
                {GRADE_LABEL[value]}
                <span className="ml-2 text-[10px] font-normal opacity-60">
                  {index + 1}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setFlipped(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-signal px-4 py-3 text-[13px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white"
          >
            <RotateCw className="size-4" />
            Flip the card
          </button>
        )}
      </div>
    </div>
  );
}

function CardFace({
  card,
  side,
  isSaved,
  saving,
  onToggleSave,
}: {
  card: Flashcard;
  side: "front" | "back";
  isSaved: boolean;
  saving: boolean;
  onToggleSave: () => void;
}) {
  const back = side === "back";
  return (
    <div
      className={`flip-face ${back ? "flip-face-back" : ""} flex min-h-[15rem] flex-col rounded-2xl border border-ink-800/15 bg-white/60 p-6 shadow-card`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className="rounded-full bg-signal/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-signal-deep">
          {card.topic} · {card.difficulty}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSave();
          }}
          disabled={saving}
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

      <div className="flex flex-1 items-center">
        <p
          className={
            back
              ? "text-[15px] leading-relaxed text-ink-300"
              : "text-[19px] font-semibold leading-snug text-ink-100"
          }
        >
          {back ? card.back : card.front}
        </p>
      </div>

      {back ? (
        <div className="mt-4 border-t border-ink-800/10 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-500">
            From {card.sourceTitle}
          </p>
          {card.sourceQuote ? (
            <p className="mt-1.5 flex gap-2 text-[12px] italic leading-relaxed text-ink-400">
              <Quote className="mt-0.5 size-3 shrink-0 text-signal-deep" />
              <span>“{card.sourceQuote}”</span>
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-ink-500">
              No verbatim sentence in that source backed this closely enough to
              quote.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-[11px] text-ink-500">Click the card to flip it.</p>
      )}
    </div>
  );
}

/**
 * The report. Score is first-attempt only, and the topics listed are the
 * ones the student actually stumbled on — grouped, because "you missed
 * cards 3, 7 and 11" is not something anyone can act on.
 */
function DeckReport({
  attempts,
  cards,
  onRestart,
}: {
  attempts: Attempt[];
  cards: Flashcard[];
  onRestart: () => void;
}) {
  const firsts = attempts.filter((a) => a.first);
  const known = firsts.filter((a) => a.grade === "known").length;
  const partial = firsts.filter((a) => a.grade === "partial").length;
  const unknown = firsts.filter((a) => a.grade === "unknown").length;
  const pct = firsts.length ? Math.round((known / firsts.length) * 100) : 0;

  const sourceFor = new Map(cards.map((c) => [c.topic, c.sourceTitle]));

  const byTopic = new Map<string, { missed: number; total: number }>();
  for (const attempt of firsts) {
    const row = byTopic.get(attempt.topic) ?? { missed: 0, total: 0 };
    row.total += 1;
    if (attempt.grade !== "known") row.missed += 1;
    byTopic.set(attempt.topic, row);
  }

  const toRevisit = Array.from(byTopic.entries())
    .filter(([, row]) => row.missed > 0)
    .sort((a, b) => b[1].missed - a[1].missed);

  return (
    <section className="mt-5 rounded-2xl border border-ink-800/15 bg-white/60 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-signal-deep">
            Round complete
          </p>
          <h3 className="mt-1 text-[28px] font-semibold leading-none text-ink-100">
            {pct}%
          </h3>
          <p className="mt-1.5 text-[12px] text-ink-500">
            known on first sight — {known} of {firsts.length} cards.{" "}
            {attempts.length - firsts.length > 0 &&
              `${attempts.length - firsts.length} repeat${attempts.length - firsts.length === 1 ? "" : "s"} to finish the round.`}
          </p>
        </div>
        <button
          onClick={onRestart}
          className="flex items-center gap-2 rounded-xl border border-ink-800/15 px-4 py-2 text-[12px] font-medium text-ink-300 transition hover:border-signal/40 hover:text-ink-100"
        >
          <RotateCcw className="size-3.5" />
          Study again
        </button>
      </div>

      <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-ink-800/10">
        {known > 0 && <div className="bg-signal" style={{ flex: known }} />}
        {partial > 0 && <div className="bg-amber-400" style={{ flex: partial }} />}
        {unknown > 0 && <div className="bg-rose-400" style={{ flex: unknown }} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-ink-500">
        <Legend color="bg-signal" label={`${known} got it`} />
        <Legend color="bg-amber-400" label={`${partial} kind of`} />
        <Legend color="bg-rose-400" label={`${unknown} not yet`} />
      </div>

      <div className="mt-6">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
          What to go back to
        </h4>
        {toRevisit.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-400">
            Nothing — you knew every card on the first pass.
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
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    in {sourceFor.get(topic) ?? "your material"}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-ink-500">
                  missed {row.missed} of {row.total}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
