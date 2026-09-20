"use client";

/**
 * Architecture — how a PDF becomes a citation.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The landing page explains what LENS refuses to do. This section is for
 * the person who wants to know whether there is anything underneath it,
 * which at a hackathon is a judge, and the honest answer is a pipeline
 * rather than a prompt.
 *
 * EVERY NUMBER HERE IS READ OUT OF THE CODE, not chosen because it looks
 * plausible. 1800/240 is lib/elastic.ts `chunks()`. 1536 is
 * lib/embeddings.ts EMBED_DIMS. 1/(60+rank) is the RRF constant in
 * hybridSearchElastic. 0.68, 0.78 and 0.88 are the measured thresholds in
 * lib/mistakes.ts and lib/coding-council.ts. If one of them changes in the
 * code and not here, this section becomes a lie, which is the risk any
 * architecture diagram runs and the reason this one cites its sources.
 *
 * Three flows rather than one picture, because they are genuinely
 * separate paths that happen to share an index — and the third is the one
 * worth the visit: kNN over what a student believes, not over what they
 * read.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Database, Layers, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

type Stage = {
  id: string;
  label: string;
  /** The one line that shows on the card. */
  headline: string;
  /** Shown when the stage is opened. */
  detail: string;
  /** Where in the repo this actually happens. */
  where: string;
};

type Flow = {
  id: string;
  name: string;
  blurb: string;
  icon: typeof Layers;
  stages: Stage[];
};

const FLOWS: Flow[] = [
  {
    id: "ingest",
    name: "Ingest",
    blurb: "A PDF becomes 1,536 numbers per passage.",
    icon: Layers,
    stages: [
      {
        id: "extract",
        label: "Extract",
        headline: "PDF, DOCX, XLSX, a URL, or a YouTube transcript",
        detail:
          "Text only. Nothing is summarised on the way in — a summary is a paraphrase, and a paraphrase cannot be quoted back as evidence later.",
        where: "lib/extract.ts",
      },
      {
        id: "chunk",
        label: "Chunk",
        headline: "1,800 characters, 240 of overlap",
        detail:
          "The overlap is the point: a sentence that straddles a boundary is still findable from either side. Without it, the passage that answers the question is the one split in half.",
        where: "lib/elastic.ts · chunks()",
      },
      {
        id: "embed",
        label: "Embed",
        headline: "text-embedding-3-small → 1,536 dimensions",
        detail:
          "The title is prepended to each chunk before embedding, so a passage carries some of its document's meaning even when read alone.",
        where: "lib/embeddings.ts",
      },
      {
        id: "index",
        label: "Index",
        headline: "One _bulk call, refresh=wait_for",
        detail:
          "Every chunk is its own document sharing a sourceId. wait_for means the upload returns only once the passages are searchable — otherwise a student uploads a PDF, asks about it, and is told there is nothing indexed.",
        where: "lens-sources",
      },
    ],
  },
  {
    id: "retrieve",
    name: "Retrieve",
    blurb: "Keywords and meaning, searched separately, fused.",
    icon: Search,
    stages: [
      {
        id: "q",
        label: "Question",
        headline: "Embedded by the same model that indexed",
        detail:
          "Not negotiable. Two embedding models produce two different vector spaces, and cosine between them is noise that looks like a score.",
        where: "lib/embeddings.ts",
      },
      {
        id: "both",
        label: "BM25 + kNN",
        headline: "Both run in parallel, k=8, num_candidates=100",
        detail:
          "BM25 catches the student who searches for a term the notes use verbatim. kNN catches the one who describes the idea in their own words. A tutor needs both, and Elastic does both in one query.",
        where: "hybridSearchElastic()",
      },
      {
        id: "rrf",
        label: "Fuse",
        headline: "Reciprocal rank fusion, 1/(60 + rank)",
        detail:
          "Fusion orders results and says nothing about whether the top one is any good, which is why the cut below reads the raw cosine instead.",
        where: "lib/elastic.ts",
      },
      {
        id: "cut",
        label: "Threshold",
        headline: "vectorScore ≥ 0.68, or no citation at all",
        detail:
          "Measured, not guessed: a different topic scores 0.540, an adjacent one 0.635, the same concept 0.696. Returning nothing is the common and correct outcome — a tutor that quotes an irrelevant slide teaches you to stop trusting its quotes.",
        where: "lib/coding-council.ts",
      },
    ],
  },
  {
    id: "recall",
    name: "Recall",
    blurb: "Search over what you believe, not what you read.",
    icon: Sparkles,
    stages: [
      {
        id: "belief",
        label: "Belief",
        headline: "The misconception is written down, not the mistake",
        detail:
          "\"Gear stages in series add their ratios\" — a sentence about what the student appears to think, stored the moment the same error happens twice.",
        where: "lens-mistakes",
      },
      {
        id: "knn",
        label: "kNN",
        headline: "Matched by meaning, across every surface",
        detail:
          "A belief formed at the camera surfaces again while debugging code, because the vectors match even when not one word does. This is the part that cannot be done with keywords.",
        where: "recallMistakes()",
      },
      {
        id: "gate",
        label: "Gate",
        headline: "0.68 mention · 0.78 same belief · 0.88 skip the model",
        detail:
          "Above 0.88 the hint is built from the recalled belief and two model calls never happen. The cheap Elastic pass is what makes the expensive one affordable.",
        where: "lib/orchestrator.ts",
      },
    ],
  },
];

const INDICES = [
  ["lens-sources", "passages + vectors"],
  ["lens-events", "everything that happened"],
  ["lens-mistakes", "beliefs, embedded"],
  ["lens-reasoning", "what LENS concluded"],
  ["lens-sessions", "work in progress"],
  ["lens-concept-maps", "how ideas connect"],
  ["lens-classes", "circles and classes"],
  ["lens-memberships", "who is in them"],
];

export function Architecture() {
  const [flowId, setFlowId] = useState(FLOWS[0].id);
  const [openStage, setOpenStage] = useState<string | null>(null);

  const flow = FLOWS.find((f) => f.id === flowId)!;

  return (
    <section id="architecture" className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
      <div className="mb-8 max-w-2xl">
        <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-signal-deep">
          <Database className="size-3.5" />
          Under it
        </div>
        <h2 className="mb-3 text-[30px] font-extrabold leading-[1.15] tracking-tight text-ink-100 sm:text-[38px]">
          A citation is a lookup, not a sentence a model wrote.
        </h2>
        <p className="text-[15px] leading-relaxed text-ink-400">
          Every passage LENS quotes was retrieved from something you
          uploaded. Here is the whole path, with the real numbers — pick a
          stage to open it.
        </p>
      </div>

      {/* ── Which flow ─────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap gap-2">
        {FLOWS.map((f) => {
          const Icon = f.icon;
          const active = f.id === flowId;
          return (
            <button
              key={f.id}
              onClick={() => {
                setFlowId(f.id);
                setOpenStage(null);
              }}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 text-[13px] transition",
                active
                  ? "bg-signal font-semibold text-white shadow-card"
                  : "border border-ink-800/15 bg-white/50 text-ink-400 hover:text-ink-200"
              )}
            >
              <Icon className="size-3.5" />
              {f.name}
            </button>
          );
        })}
        <span className="flex items-center px-2 text-[13px] text-ink-500">
          {flow.blurb}
        </span>
      </div>

      {/* ── The pipeline ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {flow.stages.map((s, i) => {
          const open = openStage === s.id;
          return (
            <div key={s.id} className="flex flex-1 items-stretch gap-2">
              <button
                onClick={() => setOpenStage(open ? null : s.id)}
                aria-expanded={open}
                className={cn(
                  "flex-1 rounded-2xl border p-4 text-left transition",
                  open
                    ? "border-signal/50 bg-signal/[0.07]"
                    : "border-ink-800/12 bg-white/50 hover:border-signal/30 hover:bg-white/80"
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-[10px] font-bold",
                      open ? "bg-signal text-white" : "bg-ink-800/10 text-ink-500"
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="text-[13px] font-bold text-ink-100">{s.label}</span>
                </div>
                <p className="text-[12px] leading-snug text-ink-400">{s.headline}</p>
              </button>

              {i < flow.stages.length - 1 && (
                <ArrowRight className="hidden size-4 shrink-0 self-center text-ink-500/40 lg:block" />
              )}
            </div>
          );
        })}
      </div>

      {/* ── The opened stage ───────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {openStage && (
          <motion.div
            key={openStage}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            {(() => {
              const s = flow.stages.find((x) => x.id === openStage)!;
              return (
                <div className="mt-3 rounded-2xl border border-signal/25 bg-white/70 p-5">
                  <p className="text-[14px] leading-relaxed text-ink-200">{s.detail}</p>
                  <p className="mt-2 font-mono text-[11.5px] text-signal-deep">{s.where}</p>
                </div>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── What is actually stored ────────────────────────────────── */}
      <div className="mt-10 rounded-3xl border border-ink-800/12 bg-white/40 p-6">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[15px] font-bold text-ink-100">Eight indices, one store</h3>
          <p className="text-[12.5px] text-ink-500">
            Elastic is the datastore, not a search sidecar — sessions and
            events live here too, which is why LENS kept working the day our
            other database went down.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {INDICES.map(([name, what]) => (
            <div
              key={name}
              className="rounded-xl border border-ink-800/10 bg-white/70 px-3 py-2.5"
            >
              <div className="truncate font-mono text-[11.5px] font-semibold text-ink-200">
                {name}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-ink-500">{what}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11.5px] text-ink-500">
          dense_vector · 1,536 dimensions · cosine · Elastic serverless, so
          storage and compute scale apart and there are no shards to tune.
        </p>
      </div>
    </section>
  );
}
