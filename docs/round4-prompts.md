# Round 4 — closing the sponsor gaps

State when written (2026-09-20 ~02:30, ~8.5 h of build left): `main` = the peach/onboarding
integration. Branch `integration/round3` = main + Devin PRs #13, #15, #14, #16 merged in order
H→J→G→F, typecheck green, 144 tests green. **Merge `integration/round3` to main first**; every
prompt below assumes it.

Criteria: [`docs/sponsor-criteria.md`](sponsor-criteria.md). It overrides `docs/sponsors.md`.
Voloridge, Warp and MongoDB were misread there; Voloridge needs their datasets, Warp wants a
developer tool, MongoDB has no challenge. **Cut those three from the plan.**

## Priority order

| # | Gap | Prize it unlocks | Who | Prompt |
|---|---|---|---|---|
| 1 | Ladder engine never runs on the live camera; `/live` still 401s for judges | every demo | Claude session 1 | C1 |
| 2 | No Codex evidence at all — half the OpenAI score | OpenAI | Codex, driven by a human | O1 |
| 3 | Skip counter + token spend not rendered; no before/after number | Token Company | Codex (O1) then Claude | C3, T1 |
| 4 | Agent doc lists tools the hook lacks; agent can't read guide steps | ElevenLabs | Claude session 2 | C2 |
| 5 | Keys are stubs; Elastic unconfigured; Deepgram never called | Elastic, Deepgram | Human + Claude session 4 | C4 |
| 6 | ElevenLabs and Espressif-style virtual judging need a Plume video + write-up | ElevenLabs, Long Lake, Ramp, Dropbox | Human | E1, S1 |
| 7 | Booth card, timeline, Cognition blurb are stale | Cognition | Devin | D2 |
| 8 | OpenAI blurb has no number | OpenAI | Devin | D3 |

File ownership (so sessions run at once without conflicts):

- C1: `components/Camera/**`, `lib/store.ts`, delete `components/product/camera/CameraView.tsx`
- C2: `hooks/useAgent.ts`, `hooks/useStallWatch.ts`
- C3 (via Codex in O1): `components/product/**` except `camera/`, `lib/persona.ts`, `lib/onboarding.ts`
- C4: `.env.local`, `demo/blurbs/05,09`, `docs/sponsors.md`
- T1: `scripts/`, `fixtures/`, `demo/blurbs/09-token-company.md`
- D2: `demo/booth/`, `docs/timeline.md`, `demo/blurbs/11-cognition.md`, `apps/lens/ELEVENLABS_AGENT.md`
- D3: `demo/blurbs/01-openai.md`

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

## O1 — Give Codex a real task so the OpenAI story is true (human drives Codex, ~45 min)

The OpenAI challenge scores Codex use as half the grade, and the demo must name **one
concrete way Codex improved the process or outcome**. There is no Codex evidence in the
tree. Manufacture none; generate some by giving Codex prompt C3 below, which is
self-contained, human-owned-component work that no other session touches.

Run it from `apps/lens` with the Codex CLI or the Codex web agent, on a branch named
`codex/metrics-strip-onboarding`. Keep the session transcript or the PR it opens. Then:

- Commit with Codex as co-author so the trail is in `git log`.
- Add a "Codex" section to `demo/blurbs/01-openai.md` with the PR number and the one
  sentence you will say on stage, for example: "Codex found that the persona gate redirect
  fired before hydration and fixed it before we had noticed." Say what actually happened.
- If Codex also catches a real bug in that area, that becomes the stage sentence.

Paste this to Codex:

> Repo: `apps/lens` (Next.js 16, App Router, Clerk, Zustand store in `lib/store.ts`). Gate:
> `npm run typecheck` and `npm test` from `apps/lens`, both must stay green. Do not touch
> `components/Camera/`, `hooks/`, `lib/reasoning.ts`, `lib/vision.ts` or any route.
>
> 1. `lib/metrics.ts` returns `modelCallsSkipped` and `tokensSpent`, and
>    `lib/frame-cascade.ts` makes the skip count move, but
>    `components/product/MetricsStrip.tsx` does not render either. Add two `Metric` cells,
>    "Model calls skipped" (highlighted when > 0) and "Tokens spent", keeping the existing
>    cells and order.
> 2. `app/app/layout.tsx` wraps `/app` in `components/product/PersonaGate.tsx`, which
>    blocks with `RoleSelection` and then redirects to `/onboarding/<persona>` until
>    onboarding is completed in that browser. Persona and completion live in
>    `localStorage` via `lib/persona.ts` and `lib/onboarding.ts`. Add a "Skip for now"
>    control on `RoleSelection` and on both onboarding pages that sets persona to
>    `student`, marks onboarding complete, and lands on `/app` in one click. Do not remove
>    the gate. Check `PersonaBadge` can switch persona without wiping onboarding state.
> 3. Write a vitest for `lib/onboarding.ts` covering hydrate, complete, and the skip path.
>
> Open a PR titled "Metrics strip: skip count and token spend; onboarding skip" with a body
> that lists anything you found that was already broken.

---

## T1 — The Token Company number (Claude Code, after `integration/round3` is on main)

> Repo: `apps/lens`. Read `docs/sponsor-criteria.md` §Token Company, `lib/token-ledger.ts`,
> `lib/frame-cascade.ts`, `lib/metrics.ts`.
>
> The judges want the most creative cost saving **inside the product** with a number. LENS
> has three real ones and no measurement:
>
> - the frame cascade: identical frame, unchanged scene, or inside a 4 s window → no vision
>   call, prior observation returned (`lib/frame-cascade.ts`);
> - prior-observation threading: each vision call gets the previous observation text, not
>   the previous frame, so the prompt is ~1 KB instead of a second image (`lib/vision.ts`);
> - Gemma as the primary reasoning model with gpt-4o-mini as fallback (`lib/llm.ts`).
>
> Build `scripts/cost-report.ts`: replay a fixed sequence of 12 frames from
> `fixtures/` (add 4 JPEGs of a desk scene: 3 identical, then a change, then 2 identical,
> etc. — small files) against `analyzeFrame` twice, once with `LENS_VISION_THROTTLE_MS=0`
> and cascade disabled via `force: true`, once with defaults. Read tokens and skips back
> from the ledger events for each run's session and print a table: calls made, calls
> skipped, tokens spent, estimated dollars at current gpt-4o pricing (put the per-token
> rate in one constant with a comment and the date). Write it with `--out
> fixtures/cost-report.json`.
>
> Needs `OPENAI_API_KEY` and a real `MONGODB_URI`; if either is missing, exit with a
> message rather than mocking. Then write `demo/blurbs/09-token-company.md` from the
> real numbers: what the cascade skipped, what it saved, and one sentence on the
> observation-threading trick. If the saving is small, say so; the creativity is the
> gate before the model, not the percentage.
>
> Scope: `scripts/cost-report.ts`, `fixtures/`, `demo/blurbs/09-token-company.md`.

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

## C3 — Metrics strip and onboarding skip

Given to Codex in O1. If Codex is unavailable, run the same prompt in a Claude Code
session and drop the Codex section from blurb 01.

---

## C4 — Keys, Elastic, Deepgram (human at the keyboard + Claude Code)

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
>    wording via `/api/search/vector?mode=elastic`, and confirm a hit. Then run two camera
>    sessions with the same wrong prediction and confirm `/api/mistakes` returns the
>    earlier mistake with an incremented count — that recurrence is the "signal" the
>    Elastic judges are asked to look for. Screenshot it for the write-up.
> 3. Deepgram: qualifies only if the app calls a Deepgram API. `DEEPGRAM_API_KEY` is set.
>    Decide in 20 minutes: mount `startThinkAloud()` from `lib/deepgram.ts` behind a
>    "Think aloud" toggle on `/live` (after C1 merges, since it owns that file), prove one
>    stamped `voice_turn` event lands in Mongo, and write blurb 05 — or delete the Deepgram
>    row from `docs/sponsors.md` and do not submit to it. Do not leave it "pending".
> 4. Delete the Voloridge and Warp rows from `docs/sponsors.md` and delete blurbs 07 and
>    10; per `docs/sponsor-criteria.md` neither challenge matches what LENS is. Keep the
>    benchmark itself — it is still the leak-check evidence for the ladder.
>
> Scope: `.env.local` (never committed), `demo/blurbs/05`, `docs/sponsors.md`, the two
> deletions.

---

## E1 — Plume submission for the virtually judged sponsors (human, 60 min, before 09:00)

ElevenLabs is judged **only** from the video and write-up. Record one 2–3 minute video
on `/live` that covers, in this order, because the rubric is in this order:

1. Agentic depth: the agent decides on its own to call `analyze_workspace`, asks a
   question, records a prediction, then `compare_to_reference` — show the tool calls in
   the Inspector panel.
2. Interaction design: interrupt it mid-sentence; show the latency.
3. Multimodal: voice plus the live camera frame with the bounding box.
4. Novelty: a physical task, hands full, no screen needed — the gear train.

Write-up: 150 words, one paragraph per rubric line, with file paths
(`hooks/useAgent.ts`, `app/api/elevenlabs/signed-url/route.ts`, `ELEVENLABS_AGENT.md` for
the personality prompt). Reuse the same video for Long Lake and Ramp.

---

## S1 — Submission paragraphs (Claude session, 15 min, no code)

> Read `README.md`, `docs/sponsor-criteria.md`, and `demo/blurbs/`. Write
> `demo/submissions.md` with one paragraph per challenge LENS submits to, each written
> against that challenge's stated rubric, not a generic pitch:
>
> - **Long Lake:** the skeptic is someone who thinks AI means chatbots. The moment: they
>   assemble the gear train, predict "three turns", and a voice asks them a question
>   instead of correcting them. Why they come back: it never once told them the answer.
> - **Ramp:** time and money saved — a tutor that watches instead of a human TA per
>   bench; the cascade so the model only wakes when something changed.
> - **Dropbox:** quote their own example ("class materials into a personalized tutor")
>   and point at `lib/dropbox.ts` → embeddings → the reasoning call's retrieved chunks.
> - **Elastic:** "find the signal" = the recurring misconception recognised across
>   sessions in different words (`lib/mistakes.ts` kNN), plus hybrid notes search.
> - **Token Company:** the cascade and observation threading, with T1's number.
> - **Cognition:** the honest Devin denominators from `docs/devin-log.md`.
> - **OpenAI:** API use and the one Codex sentence from O1.
> - **Deepgram:** only if C4 step 3 mounted it.
>
> 80–120 words each. Every paragraph names one file path. Scope: `demo/submissions.md`.

---

## D2 — Docs truth pass, round 2 (Devin)

> Read `AGENTS.md` and `docs/agent-coordination.md`. Four documents contradict the app:
>
> 1. `demo/booth/card-text.md` is the old code-tutor pitch — "runs your code against a
>    reference on hundreds of inputs", "shrinks the failure", "11 model calls skipped".
>    None of that exists in `apps/lens`. Rewrite the card from the first four paragraphs
>    of the root `README.md` and the close of `demo/script.md`. Keep it under 80 words.
>    Credits line: OpenAI · Elastic · Dropbox · ElevenLabs · Cognition · The Token Company.
>    Drop Warp, Voloridge and MongoDB from it (see `docs/sponsor-criteria.md`).
> 2. `docs/timeline.md:26` still lists a "Local GX10 fallback". ASUS was dropped; remove it.
> 3. `demo/blurbs/11-cognition.md` is an empty template. Fill it from `docs/devin-log.md`
>    and the GitHub PR list: 15 Devin PRs opened (#2–#16), 7 merged, 4 closed for scope,
>    4 merged in round 3 via `integration/round3`. Name one real defect Devin found (the
>    broken `analyze` import) and the one it introduced (Mongo driver in the client
>    bundle, caught by `lib/server-boundary.test.ts`). Honest denominators.
> 4. `apps/lens/ELEVENLABS_AGENT.md` §4 lists `set_mode` and `note_understanding`, which
>    `hooks/useAgent.ts` does not implement, and omits `compare_to_reference`, which it
>    does. Add an **"Implemented vs documented"** table at the top of §4 listing all six
>    names with a checkbox column for hook and dashboard, so a human can reconcile it.
>    Do not edit the hook.
>
> Scope: those four files only.

---

## D3 — OpenAI: make blurb 01 quotable (Devin)

> Read `demo/blurbs/README.md` and `demo/blurbs/01-openai.md`. OpenAI is the deepest
> integration in the tree and the blurb has no number in it, which breaks the blurb rule.
>
> Rewrite it from the code, not from memory:
>
> - `lib/vision.ts:188` — GPT-4o with `response_format: json_schema`, `strict: true`, so
>   the bounding box, confidence and `shouldRevealAnswer` are schema-enforced, never
>   parsed out of prose. Name the schema fields.
> - `lib/embeddings.ts` — `text-embedding-3-small` over 1,800-char chunks feeding both
>   Atlas vector search and Elastic hybrid retrieval.
> - `lib/llm.ts` — `gpt-4o-mini` is the reasoning fallback when Gemini fails, so the
>   ladder never goes dark.
> - One measured number: vision latency p50/p95 from the metrics strip after a real
>   session (`lib/metrics.ts` computes it from `camera_frame_analyzed` events). A human
>   pastes it if you have no key; leave `p50 __ / p95 __ ms` in the text.
> - Leave a `## Codex` heading empty; a human fills it from O1.
>
> 2–4 sentences, one path or number per sentence. Scope: `demo/blurbs/01-openai.md`.

---

## SpaceXAI — do not submit LENS

Hard requirements: built with Cursor, uses Grok Imagine or Grok Voice, real space data.
LENS has none of the three, and the Cursor requirement cannot be retrofitted onto 24 hours
of commits made elsewhere. The only honest path is a separate two-hour side project built
in Cursor from scratch: pull one NASA dataset, narrate it with Grok Voice, generate frames
with Grok Imagine. That costs a teammate for two hours during the hours that decide the
main demo. Skip it unless a teammate is idle.
