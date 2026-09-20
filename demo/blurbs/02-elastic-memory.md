# 02-elastic-memory

A student's recurring misconception can be recognized across sessions even when
they describe it differently. LENS embeds the student's belief and uses a
user-filtered kNN search over Elastic's `lens-mistakes` index to recall related
mistakes. A matching belief increments its occurrence count instead of creating
a duplicate, giving the tutor evidence of recurrence.

**Lives in:** `apps/lens/lib/mistakes.ts`, `apps/lens/lib/elastic.ts`
