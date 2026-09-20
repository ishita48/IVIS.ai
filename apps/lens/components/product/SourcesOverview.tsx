"use client";

/**
 * SourcesOverview — LENS Sources tier.
 * ─────────────────────────────────────────────────────────────────────
 * The retrieval half of this already worked in StudyO (Atlas Vector
 * Search over `sources.embedding`). LENS's addition is what CONSUMES it:
 * the reasoning engine cites these excerpts as evidence when a
 * misconception is conceptual rather than physical.
 */

import { FileText, Globe, Plus, Trash2, Youtube } from "lucide-react";
import { useLens } from "@/lib/store";
import { AddSourceModal } from "./AddSourceModal";
import { cn } from "@/lib/cn";

const ICONS: Record<string, any> = {
  pdf: FileText,
  youtube: Youtube,
  webpage: Globe,
};

export function SourcesOverview() {
  const { sources, toggleSource, removeSource, addSourceOpen, setAddSourceOpen } =
    useLens();

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-100">Your material</h2>
          <p className="text-[12px] text-ink-500">
            {sources.filter((s) => s.active).length} active · LENS cites these
            when it grounds an explanation
          </p>
        </div>
        <button
          onClick={() => setAddSourceOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-signal px-3 py-1.5 text-[12px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white"
        >
          <Plus className="size-3.5" />
          Add source
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto scrollbar-slim">
        {sources.length === 0 && (
          <div className="rounded-2xl border border-dashed border-ink-800/20 p-6 text-center text-[13px] text-ink-500">
            No sources yet. Drop in a PDF, a lecture URL, or a YouTube link —
            LENS embeds it and can then point at the exact passage that
            contradicts what you just did.
          </div>
        )}

        {sources.map((s) => {
          const Icon = ICONS[s.kind] ?? Globe;
          return (
            <div
              key={s._id}
              className={cn(
                "group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition",
                s.active
                  ? "border-ink-800/15 bg-white/60"
                  : "border-ink-800/10 bg-white/30 opacity-60"
              )}
            >
              <Icon className="size-4 shrink-0 text-signal-deep" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink-200">{s.title}</div>
                {s.url && (
                  <div className="truncate text-[11px] text-ink-500">{s.url}</div>
                )}
              </div>
              <button
                onClick={() => toggleSource(s._id)}
                className="rounded-full border border-ink-800/15 px-2.5 py-1 text-[11px] transition hover:border-signal/40"
              >
                {s.active ? "Active" : "Muted"}
              </button>
              <button
                onClick={() => removeSource(s._id)}
                className="opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                aria-label="Remove source"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <AddSourceModal open={addSourceOpen} onClose={() => setAddSourceOpen(false)} />
    </div>
  );
}
