# Devin log — the Cognition submission's evidence

One line per PR. Honest denominators; a judge at the Cognition table has reviewed agent PRs
before and knows the real hit rate.

| PR | Brief | Verdict | What it found or did |
|---|---|---|---|
| #2 | self-started | closed | lockfile for `apps/web`, a tree that never runs |
| #3 | self-started | closed | Vite types for the same dead tree |
| #4 | A (v1) | closed | blurbs written against a stale sponsor map — every path dead |
| #5 | 4 | **merged** | `make contracts` now really validates fixtures against schemas |
| #6 | 3 | **merged** | shrinker + ladder redaction tests, +180 lines |
| #7 | 2 (v1) | closed | duplicated the real benchmark in the dead tree |
| #8 | B | **merged** | added vitest to `apps/lens`; **found** the broken `analyze` import, the array-compare bug, four corpus cases that aren't bugs, and that `npm run lint` is broken |
| #9 | A (v2) | **merged** | 13 sponsor blurbs, all citing `apps/lens` paths, MongoDB added |
| #10 | D | **merged** | Deepgram module + route; unverifiable without a key, honestly said so |
| #11 | E | **merged** | benchmark corpus now validates all 20 cases |
| #12 | C | **merged** | token ledger + metrics; **broke the client bundle** (Mongo driver reached a `"use client"` hook) — fixed by a human in `34934cb`; `modelCallsSkipped` honestly reads 0 |
| — | F, G, H, J | running | round 3, launched overnight |

**Through round 2:** 11 Devin PRs opened, 7 merged, 4 closed for scope. Four real defects
found that humans had not. One real defect introduced, caught the same night, and now
guarded by a test.
