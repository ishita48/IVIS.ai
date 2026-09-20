"use client";

/**
 * SourcesOverview — LENS Sources tier.
 * ─────────────────────────────────────────────────────────────────────
 * Everything a student has given LENS for this session, searchable by
 * meaning rather than filename.
 *
 * The search box runs the hybrid query in `searchSourcesElastic`: a kNN
 * pass over the chunk embeddings and a BM25 pass over title and text, in
 * one request. Both halves earn their place — the vector half finds the
 * lecture that explains a thing you described in your own words, the
 * keyword half is what still finds "lecture-04.pdf" when you type the
 * filename. The snippet shown under each hit is the passage that actually
 * matched, not the first paragraph of the file.
 *
 * Sources are chunked in the index — one document per passage, all sharing
 * a `sourceId` — so every query here collapses on that field. Without it
 * the panel would list the same PDF eleven times.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Globe,
  Headphones,
  Loader2,
  Plus,
  Search,
  Trash2,
  Video,
  Youtube,
} from "lucide-react";
import { useLens } from "@/lib/store";
import { AddSourceModal } from "./AddSourceModal";
import { cn } from "@/lib/cn";
import { Working } from "./Working";

const ICONS: Record<string, any> = {
  pdf: FileText,
  youtube: Youtube,
  webpage: Globe,
  audio: Headphones,
  video: Video,
  docx: FileText,
  xlsx: FileText,
  text: FileText,
};

const KIND_LABEL: Record<string, string> = {
  pdf: "PDFs",
  youtube: "YouTube",
  webpage: "Web pages",
  audio: "Audio",
  video: "Video",
  docx: "Docs",
  xlsx: "Sheets",
  text: "Text",
};

type Row = {
  _id: string;
  sourceId?: string;
  title: string;
  kind: string;
  url?: string | null;
  active?: boolean;
  chunks?: number;
  snippet?: string | null;
  score?: number;
};

type HybridHit = {
  _id: string;
  title: string;
  text?: string;
  keywordScore?: number;
  vectorScore?: number;
};

export function SourcesOverview() {
  const sessionId = useLens((s) => s.sessionId);
  const storeSources = useLens((s) => s.sources);
  // The modal lives in the store, not in local state: Chat.tsx opens it too
  // ("add a source" from the tutor), and a second copy of the flag here
  // would leave that button doing nothing.
  const addSourceOpen = useLens((s) => s.addSourceOpen);
  const setAddSourceOpen = useLens((s) => s.setAddSourceOpen);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [hybridQuery, setHybridQuery] = useState("");
  const [hybridHits, setHybridHits] = useState<HybridHit[] | null>(null);
  const [hybridBusy, setHybridBusy] = useState(false);
  const [hybridError, setHybridError] = useState<string | null>(null);
  const [hybridSearched, setHybridSearched] = useState(false);

  const runHybridSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setHybridHits(null);
      setHybridSearched(false);
      setHybridError(null);
      return;
    }
    setHybridBusy(true);
    setHybridError(null);
    try {
      const params = new URLSearchParams({ q: q.trim(), mode: "hybrid" });
      const res = await fetch(`/api/search/vector?${params}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Hybrid search failed (${res.status}).`);
      }
      const data = await res.json();
      setHybridHits(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      setHybridError(err instanceof Error ? err.message : "Hybrid search failed.");
      setHybridHits([]);
    } finally {
      setHybridSearched(true);
      setHybridBusy(false);
    }
  }, []);

  const load = useCallback(
    async (q: string, k: string | null) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (sessionId) params.set("sessionId", sessionId);
        if (k) params.set("kind", k);
        if (q.trim()) params.set("q", q.trim());
        params.set("active", "false"); // show muted too; the row says which

        const res = await fetch(`/api/sources?${params}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Could not load sources (${res.status}).`);
        }
        const data = (await res.json()) as Row[];
        setRows(Array.isArray(data) ? data : []);
        setSearching(!!q.trim());

        const header = res.headers.get("x-lens-kind-counts");
        if (header) {
          try {
            setCounts(JSON.parse(header));
          } catch {
            /* counts are decoration */
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load sources.");
        setRows([]);
      } finally {
        setBusy(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    void load("", null);
  }, [load]);

  // Re-list when a source is added elsewhere (the modal writes to the store).
  useEffect(() => {
    if (!query.trim()) void load("", kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeSources.length]);

  const remove = async (row: Row) => {
    const id = row.sourceId || row._id;
    setRows((prev) => prev?.filter((r) => (r.sourceId || r._id) !== id) ?? prev);
    try {
      await fetch(`/api/sources?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      void useLens.getState().refreshEvents?.();
    } catch {
      void load(query, kind); // put it back if the delete did not land
    }
  };

  const toggle = async (row: Row) => {
    const id = row.sourceId || row._id;
    const next = !(row.active !== false);
    setRows(
      (prev) =>
        prev?.map((r) =>
          (r.sourceId || r._id) === id ? { ...r, active: next } : r
        ) ?? prev
    );
    try {
      await fetch(`/api/sources?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
    } catch {
      void load(query, kind);
    }
  };

  const kinds = useMemo(
    () => Object.entries(counts).filter(([, n]) => n > 0),
    [counts]
  );
  const total = rows?.length ?? 0;
  const activeCount = (rows ?? []).filter((r) => r.active !== false).length;

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink-100">Your material</h2>
          <p className="text-[12px] text-ink-500">
            {activeCount} active in this session · LENS cites these when it grounds
            an explanation
          </p>
        </div>
        <button
          onClick={() => setAddSourceOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-signal px-3 py-1.5 text-[12px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white"
        >
          <Plus className="size-3.5" />
          Add source
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────── */}
      <div className="mb-2 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(query, kind);
              if (e.key === "Escape") {
                setQuery("");
                void load("", kind);
              }
            }}
            placeholder="Search your material by meaning — “why the output reverses direction”"
            className="w-full rounded-xl border border-ink-800/15 bg-white/60 py-2 pl-9 pr-3 text-[13px] outline-none focus:border-signal/50"
          />
        </div>
        <button
          onClick={() => void load(query, kind)}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-ink-800/15 px-3 py-2 text-[12px] text-ink-300 transition hover:border-signal/40 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          Search
        </button>
      </div>

      {/* ── Category filters ───────────────────────────────────── */}
      {kinds.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Chip
            label="All"
            count={kinds.reduce((sum, [, n]) => sum + n, 0)}
            active={kind === null}
            onClick={() => {
              setKind(null);
              void load(query, null);
            }}
          />
          {kinds.map(([k, n]) => (
            <Chip
              key={k}
              label={KIND_LABEL[k] ?? k}
              count={n}
              active={kind === k}
              onClick={() => {
                const next = kind === k ? null : k;
                setKind(next);
                void load(query, next);
              }}
            />
          ))}
        </div>
      )}

      {/* ── Passage search (hybrid: raw BM25 + kNN, no fusion) ──── */}
      <div className="mb-3 rounded-xl border border-ink-800/15 bg-white/40 p-2.5">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-500" />
            <input
              value={hybridQuery}
              onChange={(e) => setHybridQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runHybridSearch(hybridQuery);
                if (e.key === "Escape") {
                  setHybridQuery("");
                  void runHybridSearch("");
                }
              }}
              placeholder="Search passages directly (hybrid)…"
              className="w-full rounded-xl border border-ink-800/15 bg-white/60 py-2 pl-9 pr-3 text-[13px] outline-none focus:border-signal/50"
            />
          </div>
          <button
            onClick={() => void runHybridSearch(hybridQuery)}
            disabled={hybridBusy}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-ink-800/15 px-3 py-2 text-[12px] text-ink-300 transition hover:border-signal/40 disabled:opacity-50"
          >
            {hybridBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Search className="size-3.5" />
            )}
            Search
          </button>
        </div>
        {hybridBusy ? (
          <Working active set="hybrid" className="mt-1.5" />
        ) : (
          <p className="mt-1.5 text-[11px] italic text-ink-500">
            hybrid: BM25 + kNN over 1,800-char chunks
          </p>
        )}

        {hybridError && (
          <div className="mt-2 rounded-xl border border-rose-300/40 bg-rose-50/60 p-3 text-[12px] text-rose-700">
            {hybridError}
          </div>
        )}

        {hybridSearched && !hybridError && (
          <div className="mt-2 space-y-1.5">
            {hybridHits && hybridHits.length > 0 ? (
              hybridHits.map((hit) => (
                <div
                  key={hit._id}
                  className="rounded-xl border border-ink-800/10 bg-white/60 px-3 py-2"
                >
                  <div className="truncate text-[13px] text-ink-200">{hit.title}</div>
                  {hit.text && (
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
                      {hit.text}
                    </p>
                  )}
                  <div className="mt-1 flex gap-3 text-[11px] font-mono text-ink-500">
                    <span>bm25 {typeof hit.keywordScore === "number" ? hit.keywordScore.toFixed(2) : "—"}</span>
                    <span>knn {typeof hit.vectorScore === "number" ? hit.vectorScore.toFixed(2) : "—"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-ink-800/20 p-4 text-center text-[12px] text-ink-500">
                Your notes don’t cover that.
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-xl border border-rose-300/40 bg-rose-50/60 p-3 text-[12px] text-rose-700">
          {error}
        </div>
      )}

      {searching && rows && (
        <p className="mb-2 text-[11px] text-ink-500">
          {total} match{total === 1 ? "" : "es"} for “{query}” · ranked by meaning,
          then keyword
        </p>
      )}

      {/* ── Results ────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto scrollbar-slim">
        {rows === null ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-800/20 p-6 text-[13px] text-ink-500">
            <Loader2 className="size-4 animate-spin" />
            Loading your material…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-800/20 p-6 text-center text-[13px] text-ink-500">
            {searching
              ? `Nothing in your material matches “${query}”.`
              : "No sources yet. Drop in a PDF, a lecture URL, or a YouTube link — LENS embeds it and can then point at the exact passage that contradicts what you just did."}
          </div>
        ) : (
          rows.map((s) => {
            const Icon = ICONS[s.kind] ?? Globe;
            const id = s.sourceId || s._id;
            const isActive = s.active !== false;
            return (
              <div
                key={id}
                className={cn(
                  "group rounded-xl border px-3 py-2.5 transition",
                  isActive
                    ? "border-ink-800/15 bg-white/60"
                    : "border-ink-800/10 bg-white/30 opacity-60"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className="size-4 shrink-0 text-signal-deep" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink-200">{s.title}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-500">
                      <span>{KIND_LABEL[s.kind] ?? s.kind}</span>
                      {typeof s.chunks === "number" && s.chunks > 1 && (
                        <span>{s.chunks} passages</span>
                      )}
                      {typeof s.score === "number" && (
                        <span className="font-mono">{s.score.toFixed(2)}</span>
                      )}
                      {s.url && <span className="truncate">{s.url}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => void toggle(s)}
                    className="shrink-0 rounded-full border border-ink-800/15 px-2.5 py-1 text-[11px] transition hover:border-signal/40"
                  >
                    {isActive ? "Active" : "Muted"}
                  </button>
                  <button
                    onClick={() => void remove(s)}
                    className="shrink-0 opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                    aria-label={`Remove ${s.title}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {searching && s.snippet && (
                  <p
                    className="mt-2 border-t border-ink-800/10 pt-2 text-[12px] leading-relaxed text-ink-400 [&_em]:not-italic [&_em]:font-semibold [&_em]:text-signal-deep"
                    dangerouslySetInnerHTML={{ __html: sanitize(s.snippet) }}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      <AddSourceModal open={addSourceOpen} onClose={() => setAddSourceOpen(false)} />
    </div>
  );
}

/**
 * Elastic highlighting returns `<em>` around the matched terms and nothing
 * else, but the surrounding text is the student's own document, so it is
 * escaped before the tags are put back. Anything else in there is content,
 * not markup.
 */
function sanitize(snippet: string): string {
  const escaped = snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/&lt;(\/?)em&gt;/g, "<$1em>");
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] transition",
        active
          ? "bg-signal font-semibold text-ink-950"
          : "border border-ink-800/15 text-ink-500 hover:text-ink-200"
      )}
    >
      {label}
      <span className="ml-1.5 opacity-60">{count}</span>
    </button>
  );
}
