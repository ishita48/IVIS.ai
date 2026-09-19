/**
 * GET /api/search/vector?q=...&k=8
 *
 * Semantic search over the user's sources. Embeds the query with OpenAI
 * and runs $vectorSearch against the `sources_vector` Atlas index.
 *
 * Optional `mode=hybrid` blends Atlas Search keyword scores with vector
 * similarity using reciprocal-rank-fusion (RRF) for the best of both.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  vectorSearchSources,
  fullTextSearchSources,
} from "@/lib/embeddings";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const mode = (searchParams.get("mode") ?? "vector").toLowerCase();
  const k = Math.max(1, Math.min(parseInt(searchParams.get("k") || "8", 10) || 8, 25));

  if (q.length < 2) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  if (mode === "hybrid") {
    // Reciprocal Rank Fusion: combine the two ranked lists.
    const [vec, text] = await Promise.all([
      vectorSearchSources({ userId, query: q, k }),
      fullTextSearchSources({ userId, query: q, limit: k }),
    ]);

    const RRF_K = 60;
    const scores = new Map<string, { doc: any; score: number }>();
    vec.forEach((d: any, i: number) => {
      scores.set(d._id, { doc: d, score: 1 / (RRF_K + i + 1) });
    });
    text.forEach((d: any, i: number) => {
      const existing = scores.get(d._id);
      const add = 1 / (RRF_K + i + 1);
      if (existing) existing.score += add;
      else scores.set(d._id, { doc: d, score: add });
    });

    const fused = [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => ({ ...x.doc, score: x.score }));

    return NextResponse.json({ mode: "hybrid", q, results: fused });
  }

  if (mode === "text") {
    const results = await fullTextSearchSources({ userId, query: q, limit: k });
    return NextResponse.json({ mode: "text", q, results });
  }

  // default: pure semantic
  const results = await vectorSearchSources({ userId, query: q, k });
  return NextResponse.json({ mode: "vector", q, results });
}
