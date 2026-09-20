# Round 4 — closing the sponsor gaps

State when written (2026-09-20 ~02:00): `main` = the peach/onboarding integration. Branch
`integration/round3` = main + Devin PRs #13, #15, #14, #16 merged in order H→J→G→F, typecheck
green, 144 tests green. **Merge `integration/round3` to main first**; every prompt below
assumes it.

Full gap analysis is in the session that wrote this file; the short version:

| Gap | Who | Prompt |
|---|---|---|
| Ladder engine never runs on the live camera (headline claim dead on stage) | Claude session 1 | C1 |
| `/live` 401 for judges — server side merged in #13, client header missing | Claude session 1 | C1 |
| Voice agent can't read guide steps; agent doc lists tools the hook lacks | Claude session 2 | C2 |
| Skip counter + token spend not rendered; onboarding gate blocks the demo laptop | Claude session 3 | C3 |
| Keys are stubs; benchmark number never produced; Elastic not configured; Deepgram unverified | Human + Claude session 4 | C4 |
| Warp workflows target the dead stack | Devin | D1 |
| Booth card, timeline, Cognition blurb, ElevenLabs tool doc are stale | Devin | D2 |

File ownership for this round (so four sessions can run at once without conflicts):

- C1: `components/Camera/**`, `lib/store.ts`, delete `components/product/camera/CameraView.tsx`
- C2: `hooks/useAgent.ts`, `hooks/useStallWatch.ts`
- C3: `components/product/**` (except `camera/`), `lib/persona.ts`, `lib/onboarding.ts`
- C4: `.env.local`, `demo/blurbs/05,09,10`, `docs/sponsors.md` rows for those three
- D1: `infra/warp/lens.yaml`
- D2: `demo/booth/`, `docs/timeline.md`, `demo/blurbs/11-cognition.md`, `apps/lens/ELEVENLABS_AGENT.md`

Gate for every PR: from `apps/lens`, `npm run typecheck` and `npm test`. Both must be green.
`lib/server-boundary.test.ts` going red means you imported a server module into a
`"use client"` file — fix the import, never the test.

---

## C1 — Make the ladder run on the live camera (Claude Code, critical)

> Repo: `apps/lens`. Read `docs/agent-coordination.md` and `demo/script.md` first.
>
> The product's headline claim is that hints climb a five-rung ladder capped on the server
> (`lib/reasoning.ts`: `nextAllowedLevel`, `capLevel`). That engine is only reached through
> `POST /api/reasoning/analyze`. The **live** camera component,
> `components/Camera/CameraView.tsx`, calls `/api/vision/analyze` directly (line ~145) and
> never calls the reasoning route. The only caller of the store action that does
> (`analyzeFrame` in `lib/store.ts:712`) is the dead copy
> `components/product/camera/CameraView.tsx`, which nothing imports. So on stage the
> Reasoning tab is empty, "Deepest rung" reads "—", and the 2:25 beat in `demo/script.md`
> dies.
>
> Do these, in order, one commit each:
>
> 1. In `components/Camera/CameraView.tsx`, after a successful vision analyze, POST to
>    `/api/reasoning/analyze` with `{ sessionId, objective, latestObservation }` (see the
>    exact body `lib/store.ts:748` sends) and push the returned `state` into the store's
>    `reasoning` field so `components/product/reasoning/ReasoningGraph.tsx` renders it.
>    Reuse the store; do not duplicate state. Prefer the engine's question over the vision
>    model's when both exist, as the store already does.
> 2. Mount `components/product/camera/UnderstandingCheck.tsx` in the live CameraView
>    wherever the reasoning state carries a check. It is #4 on the README protect list
>    and currently renders nowhere.
> 3. Delete `components/product/camera/CameraView.tsx` and remove `analyzeFrame` from the
>    store if nothing else calls it. Keep `ExperimentCard.tsx` and `PointerView.tsx`.
> 4. Demo access: PR #13 added `lib/demo-access.ts` and `POST /api/demo/token`. When the
>    page is `/live` and the user has no Clerk session, mint a token once on mount and
>    send it as `Authorization: Bearer <token>` on the fetches to `/api/vision/analyze`,
>    `/api/vision/compare` and `/api/events`. Signed-in behaviour must not change. Read
>    the route's 404/503 cases and show a one-line message on `/live` instead of a
>    broken button when demo mode is off.
> 5. Send `sceneChanged` on the analyze request. `hooks/useStallWatch.ts` already watches
>    motion; expose a boolean from it (session C2 owns that hook — if the export is not
>    there yet, send `undefined` and leave a TODO naming the export). `force: true` on the
>    manual Analyze button.
>
> Then run the app with `DEMO_MODE=1` and a 16+ char `DEMO_TOKEN_SECRET` in `.env.local`,
> open `/live` in a private window, and confirm Analyze returns 200 and the Reasoning tab
> fills. Paste the network evidence in the PR body. Scope: `components/Camera/**`,
> `lib/store.ts`, the one deletion. Do not touch `hooks/`, `lib/reasoning.ts` or any route.

---

## C2 — The voice agent reads the guide and the tools match the dashboard (Claude Code)

> Repo: `apps/lens`. Read `ELEVENLABS_AGENT.md` and `hooks/useAgent.ts` first.
>
> Two mismatches:
>
> 1. `ELEVENLABS_AGENT.md` §4 documents client tools `set_mode` and `note_understanding`.
>    `hooks/useAgent.ts` implements `analyze_workspace`, `set_pace`, `compare_to_reference`,
>    `record_prediction`. If the dashboard agent has the documented tools, it calls tools
>    the page cannot answer. Implement `set_mode` and `note_understanding` in the hook
>    with the JSON shapes the doc gives, recording each through `POST /api/events` the
>    way `record_prediction` does. Do not rename existing tools.
> 2. PR #14 added `GET /api/guide/state?sessionId=` (latest extension guide step plus
>    history). Register a `read_guide_step` client tool that calls it and returns
>    `{ goal, step, why, status }` so the agent can answer "what do I do next?" while the
>    extension is guiding. The PR body of #14 gives the exact shape.
>
> Also export a `sceneChanged: boolean` from `hooks/useStallWatch.ts` (true when the
> motion watcher saw movement since the last analyze, reset after each analyze) — session
> C1 consumes it.
>
> Verify with a real ElevenLabs session on `/live` (the key is in `.env.local`): say
> "what's my next step" with the extension running and confirm the tool fires. Scope:
> `hooks/useAgent.ts`, `hooks/useStallWatch.ts`, and the §4 tool list in
> `ELEVENLABS_AGENT.md` if a shape changed. Do not touch `components/`.

---

## C3 — Token Company on the strip, and no onboarding wall on the demo laptop (Claude Code)

> Repo: `apps/lens`.
>
> 1. `lib/metrics.ts` already returns `modelCallsSkipped` and `tokensSpent` (PR #12), and
>    PR #15's frame cascade makes the skip count move. `components/product/MetricsStrip.tsx`
>    does not render either. Add two `Metric` cells: "Model calls skipped" (highlight when
>    > 0) and "Tokens spent". Keep the existing cells and order.
> 2. `app/app/layout.tsx` wraps `/app` in `PersonaGate`, which blocks with role selection
>    and then redirects to `/onboarding/<persona>` until it is completed in that browser.
>    Persona and completion live in `localStorage` (`lib/persona.ts`, `lib/onboarding.ts`).
>    Add a "Skip for now" control on `RoleSelection` and on each onboarding page that
>    sets persona to `student` and marks onboarding complete, so a fresh browser reaches
>    the workspace in one click. Do not remove the gate.
> 3. `components/product/PersonaBadge.tsx` should let you switch persona without clearing
>    onboarding state. Check it does; fix if not.
>
> Verify: fresh private window, sign in, one click to the workspace, strip shows the two
> new cells. After two Analyze clicks on an unchanged scene within 4 s, "Model calls
> skipped" reads ≥ 1. Scope: `components/product/**` except `camera/`, `lib/persona.ts`,
> `lib/onboarding.ts`. Do not touch `components/Camera/` or `hooks/`.

---

## C4 — Keys, the benchmark number, Elastic, Deepgram (human at the keyboard + Claude Code)

> Repo: `apps/lens`. This session needs a human because it needs real keys.
>
> 1. `.env.local` has stubs: `MONGODB_URI` (17 chars), `ANTHROPIC_API_KEY` (10 chars),
>    `GOOGLE_API_KEY` (3 chars), and no `ELASTIC_URL`. Until these are real, nothing
>    persists, the metrics strip reads 0, Pointer and Guide return "offline", and Gemini
>    reasoning falls back to OpenAI. Paste real values (human does this; the agent never
>    sees them). Then `npm run db:setup`.
> 2. Elastic: `docker compose -f ../../infra/elastic/docker-compose.yml up -d`, set
>    `ELASTIC_URL=http://localhost:9200`, `npm run elastic:setup`, `npx tsx
>    scripts/elastic-check.ts`. Upload one source in `/app`, search it with different
>    wording via `/api/search/vector?mode=elastic`, and confirm a hit. Now blurbs 02 and
>    03 are true on this machine.
> 3. Voloridge: `npx tsx scripts/bench.ts --out fixtures/bench-result.json`. Commit the
>    JSON. Rewrite `demo/blurbs/10-voloridge.md` with the real leakage numbers, whatever
>    they are. A low honest number beats no number. If it is embarrassing, say so in the
>    PR and let a human decide whether to quote it.
> 4. Deepgram: `DEEPGRAM_API_KEY` is set. Decide in 20 minutes. Either mount
>    `startThinkAloud()` from `lib/deepgram.ts` behind a toggle on `/live` (session C1
>    owns that file — coordinate, or do this after C1 merges), prove one stamped
>    `voice_turn` event lands in Mongo, and write blurb 05 — or delete the blurb's claim
>    from `docs/sponsors.md` and leave the module in the tree. Do not leave it "pending".
> 5. Token Company: once C3 merges and the strip shows a non-zero skip count, write blurb
>    09 from `lib/token-ledger.ts` and `lib/frame-cascade.ts` with that number.
>
> Scope: `.env.local` (never committed), `fixtures/bench-result.json`, `demo/blurbs/05,09,10`,
> the three matching rows of `docs/sponsors.md`.

---

## D1 — Warp workflows for the app that runs (Devin)

> Read `AGENTS.md`, then `docs/sponsors.md`. `infra/warp/lens.yaml` still targets the dead
> stack: `make up`, a curl to `localhost:8000/v1/runs` with a Kadane payload, and
> `cd services/brain && python -m bench.run_bench`. None of that runs. The demo runs out of
> `apps/lens`.
>
> Rewrite the file with workflows that are true today, one-liners each, and verify every
> command by reading the script it calls in `apps/lens/package.json` or `Makefile`:
>
> - `lens dev` — `cd apps/lens && npm run dev`
> - `lens db setup` — `npm run db:setup`
> - `lens elastic up` — the docker compose line from `apps/lens/README.md` §Elastic
> - `lens elastic check` — `npx tsx scripts/elastic-check.ts`
> - `lens bench` — `npx tsx scripts/bench.ts --out fixtures/bench-result.json`
> - `lens test` — `npm run typecheck && npm test`
> - `lens demo token` — a curl to `POST /api/demo/token` on localhost:3000 (route added in
>   PR #13; read it for the response shape)
>
> Then rewrite `demo/blurbs/07-warp.md` so it no longer says the workflows "still target
> the earlier stack". Scope: `infra/warp/lens.yaml`, `demo/blurbs/07-warp.md`. No app code.

---

## D2 — Docs truth pass, round 2 (Devin)

> Read `AGENTS.md` and `docs/agent-coordination.md`. Four documents contradict the app:
>
> 1. `demo/booth/card-text.md` is the old code-tutor pitch — "runs your code against a
>    reference on hundreds of inputs", "shrinks the failure", "11 model calls skipped".
>    None of that exists in `apps/lens`. Rewrite the card from the first four paragraphs
>    of the root `README.md` and the close of `demo/script.md`. Keep it under 80 words.
>    Keep the credits line and the HTML comment about Deepgram/Token Company.
> 2. `docs/timeline.md:26` still lists a "Local GX10 fallback". ASUS was dropped; remove it.
> 3. `demo/blurbs/11-cognition.md` is an empty template. Fill it from `docs/devin-log.md`
>    and the GitHub PR list: 15 Devin PRs opened (#2–#16), 7 merged, 4 closed for scope,
>    4 open in round 3 (`integration/round3` merges them). Name one real defect Devin
>    found (the broken `analyze` import) and the one it introduced (Mongo driver in the
>    client bundle, caught by `lib/server-boundary.test.ts`). Honest denominators.
> 4. `apps/lens/ELEVENLABS_AGENT.md` §4 lists `set_mode` and `note_understanding`, which
>    `hooks/useAgent.ts` does not implement, and omits `compare_to_reference`, which it
>    does. Add a **"Implemented vs documented"** table at the top of §4 listing all six
>    names with a checkbox column for hook and dashboard, so a human can reconcile it.
>    Do not edit the hook.
>
> Scope: those four files only.
