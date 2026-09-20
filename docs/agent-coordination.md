# Who owns what

Three agents and a human team are editing this repo at once. This file is the single place
that says what is true and who may touch which files. **Read it before you start; do not
edit a file another agent owns.**

Last reconciled: 2026-09-19 late evening, at the round-3 launch. Round-3 briefs are F, G, H, J in [`docs/devin-briefs.md`](devin-briefs.md); merge order in the morning is **H → J → G → F**.

## Ground truth about the tree

LENS is an **agentic learning system for real-world tasks**, not a code tutor. It watches you
attempt something — through the camera, your voice, or your screen via the Chrome extension in
`apps/lens/extension/` — and catches the mistake as you make it. Soldering a board, assembling
the printed gear train in `apps/lens/hardware/`, a dance move in an uploaded video. Code is one
case, not the point.

The old framing — "runs your code against a reference on hundreds of inputs" — describes
`apps/web`, which was never built out. **[`README.md`](../README.md) still opens with it.**

The demo runs out of **`apps/lens/`** — a Next.js app with its own Mongo, Elastic, OpenAI,
Anthropic and ElevenLabs wiring.

`services/`, `apps/web/` and `contracts/` are an earlier architecture the build overtook.
`apps/lens` never calls them. `apps/web` has never been installed — it has no `node_modules`.
Nothing written in that tree reaches a judge. Do not add features there.

Sponsor → file map: [`docs/sponsors.md`](sponsors.md). Every path in it has been verified to
exist in `apps/lens`.

## Ownership

| Owner | Files | Rule |
|---|---|---|
| **Agent-docs session** | `AGENTS.md`, `docs/devin-briefs.md`, this file | Nobody else edits these three. |
| **Docs session** | `docs/ownership.md`, `docs/architecture.md`, `Makefile`, `apps/lens/.env.example`, `demo/script.md`, `README.md`, `demo/booth/` | Docs truth-pass. No app code. |
| **Devin** | `demo/blurbs/`, and in `apps/lens`: `lib/`, `scripts/`, `app/api/`, new test files | Per brief. Scope line in each brief is binding. |
| **Humans** | `apps/lens/components/`, `hooks/`, pages, `middleware.ts` | Closed to every agent. |

If your task needs a file you do not own, say so in your PR body or your report. Do not
reach across the line.

## State

**Done and on `main`:**
- ASUS dropped from every live claim. No hardware, so the offline-fallback story is gone.
- Sponsor map repointed at `apps/lens`; MongoDB added as a sponsor; Deepgram and Token
  Company marked pending until they are really wired.
- `AGENTS.md` rewritten for `apps/lens` — `lib/`, `scripts/`, `app/api/` open; components,
  hooks, pages, `middleware.ts` closed.
- Devin briefs A–D retargeted at `apps/lens`.
- Round 1: PRs #5 and #6 merged. #2, #3, #4, #7 closed — all four targeted the dead tree.
- Round 2 (briefs A–E, PRs #8–#12) all merged. **#12 broke the client bundle** by pulling
  the Mongo driver into a `"use client"` hook chain; fixed in `34934cb`
  (`lib/pointer-resolutions.ts`). `lib/server-boundary.test.ts` now fails on that class of
  bug and runs in `npm test`.
- Every trace of the prior project's name is gone from the tree: extension strings and
  identifiers, postMessage tags (both sides), user agents, the theme storage key, and the
  Mongo default db name (now `lens`). The extension's default API is `http://localhost:3000`;
  change one constant in `extension/background.js` when LENS has a deployment URL.
- Verified live: `/live` renders; ElevenLabs signed-url returns a real agent token; guide,
  vision and pointer routes are wired (auth-gated in the route).
- Full log of every Devin PR and what it found: [`docs/devin-log.md`](devin-log.md).

**Open:**
- `Makefile:39` — `make bench` still runs `services/brain`. The live benchmark is
  `npx tsx scripts/bench.ts` from `apps/lens`.
- `apps/lens/.env.example` does not exist, but `apps/lens/README.md` tells you to copy it.
- `docs/ownership.md:9` still lists ASUS. `docs/architecture.md:52` still states the GX10
  offline fallback as a design guarantee.
- `demo/script.md` describes the `apps/web` UI end to end. `apps/lens` has `predict`, `rung`,
  `ladder` and `shrink` as concepts but no `GapBox` and no `SourceCard` component. **Nobody
  has walked the 3-minute script against the running app.** Do that before H+18.
- **`MetricsStrip` is already mounted** at `components/product/TopBar.tsx:30`. An earlier
  version of this file said it was not — that was wrong. What is missing is the metric, not
  the mount. Brief C builds the ledger; a human still has to add a real skip path.
- **`components/product/camera/CameraView.tsx` is dead code.** Both live imports use
  `@/components/Camera/CameraView`. `UnderstandingCheck` is imported only by the dead copy, so
  the understanding check — #4 on the README protect list — renders nowhere. Components are
  human-owned; this needs a teammate, not an agent.
- **The benchmark cannot run.** Broken import (`analyze` vs `analyzeReasoning`), an array
  comparison bug, and four corpus cases where `expected === actual`. Brief E fixes it.
- `npm run lint` is broken repo-wide — it calls the removed `next lint`. Unowned.
- `docs/timeline.md:26` still lists the GX10 fallback on the cut list. Unowned.
- **`/live` cannot analyze without sign-in.** The Clerk gate inside `/api/vision/analyze`,
  `/api/pointer/screen` and `/api/guide/step` landed in the same commit (`cfde20f`) that made
  them public in middleware — it was never public in practice. A judge on their phone gets
  401. Brief H builds a rate-limited, env-gated demo path; a human wires the header in
  `CameraView`.
- **Voice and screen guide are two loops that never touch.** The ElevenLabs agent's client
  tools are `analyze_workspace` and `record_prediction` only; it cannot see the extension's
  steps. Brief G persists guide steps and exposes them; a human adds a `read_guide_step`
  client tool in `hooks/useAgent.ts`.
- `MONGODB_URI` and `ELASTIC_URL` in `.env.local` are placeholders, and `ANTHROPIC_API_KEY` is
  a stub. Nothing persists and nothing on the screen surface runs until they are real. Keys
  exist; a human updates them.
- The demo lead is **undecided** — camera on the gear train, the screen extension, or
  soldering. The team is building breadth first. Nothing below should assume one of them.

## Traps

- **`make bench` is the dead tree.** Use `npx tsx scripts/bench.ts` from `apps/lens`.
- **No test runner in `apps/lens`** until brief B lands vitest. The bar there is
  `npm run typecheck`.
- **Never delete or skip `lib/server-boundary.test.ts`.** If it goes red, the fix is to move
  what the client needs into a module with no server imports — never to remove the check.
- **Branch from current `main`.** Round 1 produced four dead PRs because the sessions
  branched before the sponsor repoint.
- **No API keys on any agent machine.** No `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`,
  `ELEVENLABS_API_KEY`, `DROPBOX_ACCESS_TOKEN`; no Elastic on `localhost:9200`. If proving
  your change needs one, say so instead of mocking a number.
