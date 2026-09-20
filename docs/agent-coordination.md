# Who owns what

Three agents and a human team are editing this repo at once. This file is the single place
that says what is true and who may touch which files. **Read it before you start; do not
edit a file another agent owns.**

Last reconciled at `cb979df`.

## Ground truth about the tree

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

**Open:**
- `Makefile:39` — `make bench` still runs `services/brain`. The live benchmark is
  `npx tsx scripts/bench.ts` from `apps/lens`.
- `apps/lens/.env.example` does not exist, but `apps/lens/README.md` tells you to copy it.
- `docs/ownership.md:9` still lists ASUS. `docs/architecture.md:52` still states the GX10
  offline fallback as a design guarantee.
- `demo/script.md` describes the `apps/web` UI end to end. `apps/lens` has `predict`, `rung`,
  `ladder` and `shrink` as concepts but no `GapBox` and no `SourceCard` component. **Nobody
  has walked the 3-minute script against the running app.** Do that before H+18.
- The 2:15 beat points at a model-call counter that does not exist yet. Devin brief C builds
  the ledger; a human still has to add a real skip path and mount `MetricsStrip`.

## Traps

- **`make bench` is the dead tree.** Use `npx tsx scripts/bench.ts` from `apps/lens`.
- **No test runner in `apps/lens`** until brief B lands vitest. The bar there is
  `npm run typecheck`.
- **Branch from current `main`.** Round 1 produced four dead PRs because the sessions
  branched before the sponsor repoint.
- **No API keys on any agent machine.** No `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`,
  `ELEVENLABS_API_KEY`, `DROPBOX_ACCESS_TOKEN`; no Elastic on `localhost:9200`. If proving
  your change needs one, say so instead of mocking a number.
