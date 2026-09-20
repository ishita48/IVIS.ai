"use client";

/**
 * StudyLibrary — the cards and questions the student kept.
 *
 * Every row carries its own history, because the useful thing about a saved
 * item is not that it was saved, it is that you have got it wrong four
 * times. Sorted by that: what was fought with most sits at the top.
 *
 * Studying from here re-uses FlashcardDeck and QuizRunner unchanged — a
 * saved item and a freshly generated one are the same shape, so there is
 * one study surface per kind, not two.
 */

import { useCallback, useEffect, useState } from "react";
import { Layers3, ListChecks, Loader2, Play, Trash2 } from "lucide-react";
import { FlashcardDeck } from "./FlashcardDeck";
import { QuizRunner } from "./QuizRunner";
import {
  GRADE_LABEL,
  type LibraryKind,
  type SavedFlashcard,
  type SavedQuizQuestion,
} from "@/lib/lens/contracts";

export function StudyLibrary() {
  const [kind, setKind] = useState<LibraryKind>("card");
  const [cards, setCards] = useState<SavedFlashcard[] | null>(null);
  const [questions, setQuestions] = useState<SavedQuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [studying, setStudying] = useState(false);

  const load = useCallback(async (which: LibraryKind) => {
    setError(null);
    try {
      const res = await fetch(`/api/study-library?kind=${which}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        items?: any[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not load your library.");
      if (which === "card") setCards(data.items ?? []);
      else setQuestions(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your library.");
      if (which === "card") setCards([]);
      else setQuestions([]);
    }
  }, []);

  useEffect(() => {
    void load(kind);
    setStudying(false);
  }, [kind, load]);

  const remove = async (id: string) => {
    if (kind === "card") setCards((prev) => prev?.filter((c) => c.id !== id) ?? prev);
    else setQuestions((prev) => prev?.filter((q) => q.id !== id) ?? prev);
    try {
      await fetch(`/api/study-library?kind=${kind}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      void load(kind); // put it back if the write did not land
    }
  };

  const items = kind === "card" ? cards : questions;

  const tabs = (
    <div className="flex items-center gap-1 rounded-full border border-ink-800/15 bg-white/50 p-0.5">
      {(
        [
          { id: "card" as const, label: "Cards", icon: Layers3 },
          { id: "question" as const, label: "Questions", icon: ListChecks },
        ]
      ).map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => setKind(tab.id)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] transition ${
              kind === tab.id
                ? "bg-signal font-semibold text-ink-950"
                : "text-ink-500 hover:text-ink-200"
            }`}
          >
            <Icon className="size-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  if (items === null) {
    return (
      <div className="mt-5">
        {tabs}
        <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-800/15 p-10 text-[13px] text-ink-500">
          <Loader2 className="size-4 animate-spin" />
          Loading your library…
        </div>
      </div>
    );
  }

  if (studying && items.length > 0) {
    return (
      <div className="mt-5">
        <button
          onClick={() => setStudying(false)}
          className="mb-3 rounded-full border border-ink-800/15 px-3 py-1.5 text-[12px] text-ink-400 transition hover:text-ink-100"
        >
          Back to library
        </button>
        {kind === "card" ? (
          <FlashcardDeck cards={cards ?? []} />
        ) : (
          <QuizRunner questions={questions ?? []} title="Saved questions" />
        )}
      </div>
    );
  }

  return (
    <div className="mt-5">
      {error && (
        <div className="mb-3 rounded-xl border border-rose-300/40 bg-rose-50/60 p-3 text-[12px] text-rose-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {tabs}
        {items.length > 0 && (
          <button
            onClick={() => setStudying(true)}
            className="flex items-center gap-2 rounded-xl bg-signal px-4 py-2 text-[12px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white"
          >
            <Play className="size-3.5" />
            {kind === "card" ? "Study these" : "Quiz me on these"}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-800/15 p-10 text-center text-[13px] text-ink-500">
          Nothing saved yet. Generate a{" "}
          {kind === "card" ? "deck" : "quiz"} and tap the bookmark on anything
          worth keeping.
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {kind === "card"
            ? [...(cards ?? [])]
                .sort((a, b) => b.missed - a.missed)
                .map((card) => (
                  <li
                    key={card.id}
                    className="rounded-2xl border border-ink-800/15 bg-white/60 p-4"
                  >
                    <Header
                      topic={card.topic}
                      onRemove={() => void remove(card.id)}
                    />
                    <p className="mt-2 text-[14px] font-semibold leading-snug text-ink-100">
                      {card.front}
                    </p>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
                      {card.back}
                    </p>
                    <Footer
                      source={card.sourceTitle}
                      attempts={card.reviews}
                      wrong={card.missed}
                      last={card.lastGrade ? GRADE_LABEL[card.lastGrade] : null}
                    />
                  </li>
                ))
            : [...(questions ?? [])]
                .sort((a, b) => b.wrong - a.wrong)
                .map((question) => (
                  <li
                    key={question.id}
                    className="rounded-2xl border border-ink-800/15 bg-white/60 p-4"
                  >
                    <Header
                      topic={question.topic}
                      onRemove={() => void remove(question.id)}
                    />
                    <p className="mt-2 text-[14px] font-semibold leading-snug text-ink-100">
                      {question.prompt}
                    </p>
                    <p className="mt-2 text-[12px] leading-relaxed text-signal-deep">
                      {question.choices[question.correctIndex]}
                    </p>
                    <Footer
                      source={question.sourceTitle}
                      attempts={question.attempts}
                      wrong={question.wrong}
                      last={
                        question.lastCorrect === null
                          ? null
                          : question.lastCorrect
                            ? "Correct"
                            : "Wrong"
                      }
                    />
                  </li>
                ))}
        </ul>
      )}
    </div>
  );
}

function Header({ topic, onRemove }: { topic: string; onRemove: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="rounded-full bg-signal/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-signal-deep">
        {topic}
      </span>
      <button
        onClick={onRemove}
        title="Remove from library"
        className="shrink-0 rounded-full p-1.5 text-ink-500 transition hover:text-rose-500"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function Footer({
  source,
  attempts,
  wrong,
  last,
}: {
  source: string;
  attempts: number;
  wrong: number;
  last: string | null;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-800/10 pt-2.5 text-[10px] text-ink-500">
      <span>from {source}</span>
      {attempts > 0 && (
        <span>
          {attempts} attempt{attempts === 1 ? "" : "s"}
        </span>
      )}
      {wrong > 0 && (
        <span className="font-medium text-amber-600">missed {wrong}×</span>
      )}
      {last && <span>last: {last}</span>}
    </div>
  );
}
