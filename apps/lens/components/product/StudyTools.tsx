"use client";

import { useState } from "react";
import { BookOpen, Check, Film, GitBranch, Layers3, Loader2, Sparkles } from "lucide-react";
import { useLens } from "@/lib/store";

type Mode = "summary" | "flashcards" | "quiz" | "concept-map" | "video";

const TOOLS: { id: Mode; label: string; icon: typeof BookOpen; description: string }[] = [
  { id: "summary", label: "Summary", icon: BookOpen, description: "A concise overview and key points." },
  { id: "flashcards", label: "Flashcards", icon: Layers3, description: "Practice cards from your sources." },
  { id: "quiz", label: "Quiz", icon: Check, description: "Multiple choice with explanations." },
  { id: "concept-map", label: "Concept map", icon: GitBranch, description: "Connect the important ideas." },
  { id: "video", label: "Video summary", icon: Film, description: "A narrated storyboard you can study like a mini-lecture." },
];

export function StudyTools() {
  const sessionId = useLens((state) => state.sessionId);
  const [mode, setMode] = useState<Mode>("summary");
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
        <div className="grid gap-2 sm:grid-cols-5">
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
        <div className="mt-4 flex gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What should this focus on? (optional)" className="min-w-0 flex-1 rounded-xl border border-ink-800/15 bg-white/60 px-3 py-2 text-[13px] outline-none focus:border-signal/50" />
          <button onClick={generate} disabled={busy} className="flex items-center gap-2 rounded-xl bg-signal px-4 py-2 text-[12px] font-semibold text-ink-950 disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Generate
          </button>
        </div>
        {error && <div className="mt-4 rounded-xl border border-rose-300/40 bg-rose-50/60 p-3 text-[12px] text-rose-700">{error}</div>}
        {result && <ResultView mode={mode} result={result} />}
        {!result && !busy && <div className="mt-6 rounded-2xl border border-dashed border-ink-800/15 p-10 text-center text-[13px] text-ink-500">Choose a tool and generate from your uploaded sources.</div>}
      </div>
    </div>
  );
}

function ResultView({ mode, result }: { mode: Mode; result: any }) {
  if (mode === "summary") return <section className="mt-5 rounded-2xl border border-ink-800/15 bg-white/60 p-5"><h3 className="text-[16px] font-semibold text-ink-100">{result.title}</h3><p className="mt-3 text-[13px] leading-relaxed text-ink-300">{result.overview}</p><ul className="mt-4 space-y-2">{result.keyPoints?.map((point: string) => <li key={point} className="text-[13px] text-ink-300">• {point}</li>)}</ul></section>;
  if (mode === "flashcards") return <div className="mt-5 grid gap-3 md:grid-cols-2">{result.cards?.map((card: any, index: number) => <article key={index} className="rounded-2xl border border-ink-800/15 bg-white/60 p-4"><div className="text-[10px] uppercase tracking-wider text-signal-deep">Card {index + 1} · {card.difficulty}</div><h3 className="mt-2 text-[14px] font-semibold text-ink-100">{card.front}</h3><p className="mt-3 text-[13px] leading-relaxed text-ink-400">{card.back}</p></article>)}</div>;
  if (mode === "quiz") return <section className="mt-5 space-y-3">{result.questions?.map((question: any, index: number) => <article key={index} className="rounded-2xl border border-ink-800/15 bg-white/60 p-4"><div className="text-[10px] uppercase tracking-wider text-signal-deep">Question {index + 1}</div><h3 className="mt-2 text-[14px] font-semibold text-ink-100">{question.prompt}</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{question.choices?.map((choice: string, choiceIndex: number) => <div key={choice} className="rounded-lg border border-ink-800/10 px-3 py-2 text-[12px] text-ink-300">{String.fromCharCode(65 + choiceIndex)}. {choice}</div>)}</div><p className="mt-3 text-[11px] text-ink-500">Answer: {question.choices?.[question.correctIndex]} · {question.explanation}</p></article>)}</section>;
  if (mode === "concept-map") return <section className="mt-5 grid gap-3 md:grid-cols-2"><div className="rounded-2xl border border-ink-800/15 bg-white/60 p-4"><h3 className="text-[15px] font-semibold text-ink-100">{result.title}</h3><div className="mt-3 space-y-2">{result.nodes?.map((node: any) => <div key={node.id} className="rounded-xl bg-signal/5 p-3"><div className="text-[13px] font-semibold text-ink-200">{node.label}</div><div className="mt-1 text-[11px] text-ink-500">{node.description}</div></div>)}</div></div><div className="rounded-2xl border border-ink-800/15 bg-white/60 p-4"><h3 className="text-[12px] font-semibold uppercase tracking-wider text-signal-deep">Connections</h3><div className="mt-3 space-y-2">{result.edges?.map((edge: any, index: number) => <div key={index} className="text-[12px] text-ink-300">{edge.from} <span className="text-signal">→</span> {edge.to}<div className="text-[10px] text-ink-500">{edge.relationship}</div></div>)}</div></div></section>;
  return <section className="mt-5 rounded-2xl border border-ink-800/15 bg-white/60 p-5"><div className="text-[10px] uppercase tracking-wider text-signal-deep">Video summary · {result.title}</div><h3 className="mt-2 text-[18px] font-semibold text-ink-100">{result.hook}</h3><div className="mt-4 space-y-3">{result.scenes?.map((scene: any, index: number) => <article key={index} className="rounded-xl border border-ink-800/10 bg-white/50 p-3"><div className="flex justify-between text-[11px] text-signal-deep"><span>{index + 1}. {scene.heading}</span><span>{scene.durationSec}s</span></div><p className="mt-2 text-[13px] leading-relaxed text-ink-300">{scene.narration}</p><p className="mt-2 text-[10px] text-ink-500">Visual: {scene.visualPrompt}</p></article>)}</div><pre className="mt-4 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-400">{result.transcript}</pre></section>;
}