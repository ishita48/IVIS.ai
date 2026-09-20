# 01-openai

Every look at the student's workspace is one GPT-4o call in `apps/lens/lib/vision.ts:188` with `response_format: json_schema` and `strict: true`, so the fields `observation`, `objects`, `boundingBox` (`x`, `y`, `width`, `height`), `confidence`, `changedSincePrior` and `shouldRevealAnswer` are schema-enforced, never parsed out of prose — and `shouldRevealAnswer` is pinned to `false` in the schema itself. Uploaded notes are embedded with `text-embedding-3-small` in `apps/lens/lib/embeddings.ts` over 1,800-character chunks with 240 characters of overlap (`apps/lens/lib/elastic.ts:87`), feeding both the Atlas `vectorSearch` index and Elastic's hybrid BM25 + kNN retrieval. When Gemini fails, `apps/lens/lib/llm.ts` falls back to `gpt-4o-mini`, so the hint ladder never goes dark. Vision latency from `apps/lens/lib/metrics.ts`, computed over `camera_frame_analyzed` events after a real session: p50 __ / p95 __ ms.

**Lives in:** `apps/lens/lib/vision.ts`, `apps/lens/lib/embeddings.ts`, `apps/lens/lib/llm.ts`, `apps/lens/lib/metrics.ts`

## Codex

[PR #20](https://github.com/raoisha1/IVIS.ai/pull/20): Codex caught that the metrics strip omitted model calls skipped and tokens spent even though the metrics backend already returned both values.
