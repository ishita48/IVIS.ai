/**
 * Embeddings + MongoDB Atlas Vector Search helpers.
 *
 * - Uses OpenAI `text-embedding-3-small` (1536 dims) — cheapest model that
 *   is still strong on English study content. Switch via OPENAI_EMBED_MODEL.
 * - Embeddings are stored on `sources.embedding` (declared in db-setup).
 * - Vector queries use `$vectorSearch` on the `sources_vector` Atlas index
 *   (created by `npm run search:setup`).
 */

import OpenAI from "openai";
import { ObjectId } from "mongodb";
import { recordCall, openaiUsage, type LedgerScope } from "./token-ledger";

export const EMBED_MODEL =
  process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
export const EMBED_DIMS = 1536; // matches text-embedding-3-small default
export const VECTOR_INDEX = "sources_vector";
export const SEARCH_INDEX = "sources_search";

let _openai: OpenAI | null = null;
function client() {
  if (_openai) return _openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing — embeddings disabled");
  _openai = new OpenAI({ apiKey: key });
  return _openai;
}

/** Cap input to ~8000 tokens (~32k chars). text-embedding-3 supports 8192. */
function clip(text: string, max = 28000) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** `ledger` bills the call to a session; callers without one leave it unbilled. */
export async function embedText(
  text: string,
  ledger?: LedgerScope | null
): Promise<number[] | null> {
  const input = clip(text);
  if (!input) return null;
  const startedAt = Date.now();
  try {
    const res = await client().embeddings.create({
      model: EMBED_MODEL,
      input,
    });
    void recordCall({
      scope: ledger,
      provider: "openai",
      model: EMBED_MODEL,
      purpose: "embeddings.embed",
      ...openaiUsage(res.usage),
      latencyMs: Date.now() - startedAt,
    });
    return res.data[0]?.embedding ?? null;
  } catch (err) {
    console.warn("[embeddings] failed:", (err as Error).message);
    return null;
  }
}

/**
 * Generate + persist an embedding for a single source. Safe to fire-and-
 * forget from insert routes — never throws, never blocks the response.
 */
export function embedSourceFireAndForget(
  sourceId: ObjectId | string,
  text: string,
  title?: string,
  elastic?: {
    userId: string;
    sessionId?: string | null;
    kind: string;
    /** Carried into the index so the Sources panel can link out. */
    url?: string | null;
  }
) {
  // Compose: title gets prepended so titles dominate retrieval slightly.
  const body = [title, text].filter(Boolean).join("\n\n");
  if (!body.trim()) return;
  void (async () => {
    try {
      const vec = await embedText(body);
      if (!vec) return;
      if (elastic) {
        const { indexSourceInElastic } = await import("./elastic");
        indexSourceInElastic({
          id: String(sourceId),
          userId: elastic.userId,
          sessionId: elastic.sessionId,
          kind: elastic.kind,
          url: elastic.url ?? null,
          active: true,
          title: title || "Untitled source",
          text,
        });
      }
      try {
        const { getDb } = await import("./mongodb");
        const db = await getDb();
        await db
          .collection("sources")
          .updateOne(
            { _id: typeof sourceId === "string" ? new ObjectId(sourceId) : sourceId },
            { $set: { embedding: vec, embeddingModel: EMBED_MODEL, embeddedAt: new Date() } }
          );
      } catch (error) {
        if (!elastic) throw error;
        console.warn("[embeddings] Mongo persistence skipped; Elastic is primary:", (error as Error).message);
      }
    } catch (err) {
      console.warn("[embeddings] background update failed:", (err as Error).message);
    }
  })();
}

/**
 * Run a $vectorSearch against the sources collection scoped to one user.
 * Returns matched sources with similarity score in [0,1].
 */
export async function vectorSearchSources(opts: {
  userId: string;
  query: string;
  k?: number;
  numCandidates?: number;
}) {
  const { userId, query } = opts;
  const k = Math.max(1, Math.min(opts.k ?? 8, 25));
  const numCandidates = Math.max(k * 10, opts.numCandidates ?? 100);

  const queryVec = await embedText(query);
  if (!queryVec) return [];

  const { getDb } = await import("./mongodb");
  const db = await getDb();
  const docs = await db
    .collection("sources")
    .aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX,
          path: "embedding",
          queryVector: queryVec,
          numCandidates,
          limit: k,
          filter: { userId },
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          kind: 1,
          url: 1,
          sessionId: 1,
          badge: 1,
          metadata: 1,
          extractedText: { $substrCP: [{ $ifNull: ["$extractedText", ""] }, 0, 240] },
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();

  return docs.map((d: any) => ({
    ...d,
    _id: String(d._id),
    sessionId: d.sessionId ? String(d.sessionId) : null,
  }));
}

/**
 * Atlas Search ($search) over sources for a user — fuzzy + scored across
 * title and extractedText. Falls back to [] if the index is missing.
 */
export async function fullTextSearchSources(opts: {
  userId: string;
  query: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(opts.limit ?? 12, 50));
  const { getDb } = await import("./mongodb");
  const db = await getDb();
  try {
    return await db
      .collection("sources")
      .aggregate([
        {
          $search: {
            index: SEARCH_INDEX,
            compound: {
              must: [
                {
                  text: {
                    query: opts.query,
                    path: ["title", "extractedText"],
                    fuzzy: { maxEdits: 1, prefixLength: 2 },
                  },
                },
              ],
              filter: [{ equals: { path: "userId", value: opts.userId } }],
            },
          },
        },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            title: 1,
            kind: 1,
            url: 1,
            sessionId: 1,
            badge: 1,
            metadata: 1,
            extractedText: { $substrCP: [{ $ifNull: ["$extractedText", ""] }, 0, 240] },
            score: { $meta: "searchScore" },
          },
        },
      ])
      .toArray()
      .then((docs) =>
        docs.map((d: any) => ({
          ...d,
          _id: String(d._id),
          sessionId: d.sessionId ? String(d.sessionId) : null,
        }))
      );
  } catch (err) {
    // Index not yet provisioned, etc.
    console.warn("[atlas-search] $search failed:", (err as Error).message);
    return [];
  }
}
