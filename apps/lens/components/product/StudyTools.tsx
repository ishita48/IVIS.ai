"use client";

import { useState } from "react";
import { BookOpen, Bookmark, Brain, Check, Film, GitBranch, Layers3, Loader2, Sparkles } from "lucide-react";
import { useLens, type StudyMode } from "@/lib/store";
import { FlashcardDeck } from "./flashcards/FlashcardDeck";
import { QuizRunner } from "./flashcards/QuizRunner";
import { StudyLibrary } from "./flashcards/StudyLibrary";
import { MistakeMemory } from "./flashcards/MistakeMemory";
import { VideoSummary } from "./video/VideoSummary";

type Mode = StudyMode;

const TOOLS: { id: Mode; label: string; icon: typeof BookOpen; description: string }[] = [
  { id: "summary", label: "Summary", icon: BookOpen, description: "A concise overview and key points." },
  { id: "flashcards", label: "Flashcards", icon: Layers3, description: "Flip, grade yourself, repeat what you miss." },
  { id: "quiz", label: "Quiz", icon: Check, description: "One question at a time, then your score." },
  { id: "concept-map", label: "Concept map", icon: GitBranch, description: "Connect the important ideas." },
  { id: "video", label: "Video summary", icon: Film, description: "A narrated mini-lecture that actually plays." },
  { id: "library", label: "Library", icon: Bookmark, description: "Everything you saved, and what you keep missing." },
  { id: "memory", label: "Memory", icon: Brain, description: "Beliefs you keep returning to, matched by meaning." },
];

/** Modes that read their own data rather than generating from sources. */
const SELF_LOADING: Mode[] = ["library", "memory"];

export function StudyTools() {
  const sessionId = useLens((state) => state.sessionId);
  const mode = useLens((state) => state.studyMode);
  const setMode = useLens((state) => state.setStudyMode);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/study-tools/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, query: query.trim() || undefined, sessionId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Generation failed");
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 scrollbar-slim">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-ink-100">Study tools</h2>
            <p className="mt-1 text-[12px] text-ink-500">Everything here is generated from your indexed material.</p>
          </div>
          <Sparkles className="size-5 text-signal" />
        </div>
        <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button key={tool.id} onClick={() => { setMode(tool.id); setResult(null); }} className={`rounded-xl border p-3 text-left transition ${mode === tool.id ? "border-signal/60 bg-signal/10" : "border-ink-800/15 bg-white/40 hover:bg-white/70"}`}>
                <Icon className="mb-2 size-4 text-signal-deep" />
                <div className="text-[12px] font-semibold text-ink-100">{tool.label}</div>
                <div className="mt-1 text-[10px] leading-relaxed text-ink-500">{tool.description}</div>
              </button>
            );
          })}
        </div>
        {!SELF_LOADING.includes(mode) && (
        <div className="mt-4 flex gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What should this focus on? (optional)" className="min-w-0 flex-1 rounded-xl border border-ink-800/15 bg-white/60 px-3 py-2 text-[13px] outline-none focus:border-signal/50" />
          <button onClick={generate} disabled={busy} className="flex items-center gap-2 rounded-xl bg-signal px-4 py-2 text-[12px] font-semibold text-ink-950 disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Generate
          </button>
        </div>
        )}
        {error && <div className="mt-4 rounded-xl border border-rose-300/40 bg-rose-50/60 p-3 text-[12px] text-rose-700">{error}</div>}
        {mode === "library" && <StudyLibrary />}
        {mode === "memory" && <MistakeMemory />}
        {!SELF_LOADING.includes(mode) && result && <ResultView mode={mode} result={result} />}
        {!SELF_LOADING.includes(mode) && !result && !busy && <div className="mt-6 rounded-2xl border border-dashed border-ink-800/15 p-10 text-center text-[13px] text-ink-500">Choose a tool and generate from your uploaded sources.</div>}
      </div>
    </div>
  );
}

function ResultView({ mode, result }: { mode: Mode; result: any }) {
  if (mode === "summary") return <section className="mt-5 rounded-2xl border border-ink-800/15 bg-white/60 p-5"><h3 className="text-[16px] font-semibold text-ink-100">{result.title}</h3><p className="mt-3 text-[13px] leading-relaxed text-ink-300">{result.overview}</p><ul className="mt-4 space-y-2">{result.keyPoints?.map((point: string) => <li key={point} className="text-[13px] text-ink-300">• {point}</li>)}</ul></section>;
  if (mode === "flashcards") {
    const cards = result.cards ?? [];
    if (!cards.length) return <Empty what="cards" />;
    return <FlashcardDeck cards={cards} />;
  }
  if (mode === "quiz") {
    const questions = result.questions ?? [];
    if (!questions.length) return <Empty what="questions" />;
    return <QuizRunner questions={questions} title={result.title} />;
  }
  if (mode === "concept-map") return <section className="mt-5 grid gap-3 md:grid-cols-2"><div className="rounded-2xl border border-ink-800/15 bg-white/60 p-4"><h3 className="text-[15px] font-semibold text-ink-100">{result.title}</h3><div className="mt-3 space-y-2">{result.nodes?.map((node: any) => <div key={node.id} className="rounded-xl bg-signal/5 p-3"><div className="text-[13px] font-semibold text-ink-200">{node.label}</div><div className="mt-1 text-[11px] text-ink-500">{node.description}</div></div>)}</div></div><div className="rounded-2xl border border-ink-800/15 bg-white/60 p-4"><h3 className="text-[12px] font-semibold uppercase tracking-wider text-signal-deep">Connections</h3><div className="mt-3 space-y-2">{result.edges?.map((edge: any, index: number) => <div key={index} className="text-[12px] text-ink-300">{edge.from} <span className="text-signal">→</span> {edge.to}<div className="text-[10px] text-ink-500">{edge.relationship}</div></div>)}</div></div></section>;
  return <VideoSummary result={result} />;
}
function Empty({ what }: { what: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-ink-800/15 p-10 text-center text-[13px] text-ink-500">
      No usable {what} came back from that material. Try a narrower focus, or
      add a source with more detail in it.
    </div>
  );
}
