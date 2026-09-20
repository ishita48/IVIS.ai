# 01-openai

Students can ask LENS to inspect their workspace and highlight the part worth
attention. OpenAI vision returns an observation, a bounding box, and a confidence
score, while OpenAI embeddings make uploaded study material searchable by meaning.

**Lives in:** `apps/lens/lib/vision.ts`, `apps/lens/lib/embeddings.ts`

## Codex

[PR #20](https://github.com/raoisha1/IVIS.ai/pull/20): Codex caught that the metrics strip omitted model calls skipped and tokens spent even though the metrics backend already returned both values.
