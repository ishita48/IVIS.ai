# 03-elastic-search

LENS sends a student's uploaded material to Elastic as 1,800-character chunks
with 1536-dimensional embeddings. The source tier fuses BM25 keyword matches
with kNN vector matches, so the tutor can retrieve the exact passage even when
the student's wording differs from the notes.

**Lives in:** `apps/lens/lib/elastic.ts`
