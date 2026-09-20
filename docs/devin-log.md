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
| #13 | H | **merged** | rate-limited, env-gated demo access (`demo-access.ts`, `/api/demo/token`); **found** the new token route and `/api/pointer/screen` were missing from the auth middleware's public matcher |
| #14 | G | **merged** | guide state reader (`guide-state.ts`) and `GET /api/guide/state`, built on `guide_step` events already persisted |
| #15 | J | **merged** | frame cascade in `analyzeFrame`: skips the vision call on an identical frame hash, `sceneChanged: false`, or inside the 4s throttle; every skip recorded via `recordSkip` |
| #16 | F | **merged** | curated demo objectives (gear-train, solder-led, percent-discount) with deterministic 5-rung ladders; matches a known wrong prediction and skips the model entirely |
| #21 | W1 (Warp) | **merged** | moved the boundary check into a standalone CLI, `apps/lens/scripts/boundary-check.ts`, any Next.js repo can run; rewrote `infra/warp/lens.yaml` and the Warp blurb |
| #23 | D2/D3 | **merged** | docs truth pass round 2: rewrote sponsor blurbs, `sponsors.md` rows, and the ElevenLabs tool table from verified paths |

**Final:** 17 Devin PRs opened, 13 merged, 4 closed for scope, 0 open. Four real defects
found that humans had not. One real defect introduced — the Mongo driver reached a
client bundle in PR #12 — found after merge; the guard test landed the same night and
is now `apps/lens/scripts/boundary-check.ts`.
