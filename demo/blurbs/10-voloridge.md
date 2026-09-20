# 10-voloridge

**Nothing in the tree qualifies for this challenge yet.** Voloridge judges work built on
their curated public datasets; the 20-bug harness in `apps/lens/scripts/bench.ts` uses none
of them, so it is not the Voloridge claim. The intended entry is the data objective in
prompt V1 — the student predicts an answer about a real dataset, a pandas snippet runs, and
the ladder names the belief behind the wrong prediction — and it is unbuilt.

What the benchmark *is* good for is the ladder's leak check, which is a claim LENS can make
today: `lib/objectives.test.ts` runs `deterministicLeakCheck` over all 6 curated ladders and
asserts that none of the 24 rungs below the top reveals the fix, while rung 4 always does.
That is the product's thesis tested against its own demo content, not a sponsor integration.

**Lives in:** `apps/lens/lib/leak-check.ts`, `apps/lens/lib/objectives.test.ts`
(Voloridge path, when built: `apps/lens/lib/datasets/`, `apps/lens/lib/objectives.ts`)
