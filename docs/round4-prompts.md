# Round 4 — closing the sponsor gaps

State when written (2026-09-20 ~02:30, ~8.5 h of build left): `main` = the peach/onboarding
integration. Branch `integration/round3` = main + Devin PRs #13, #15, #14, #16 merged in order
H→J→G→F, typecheck green, 144 tests green. **Merge `integration/round3` to main first**; every
prompt below assumes it.

Criteria: [`docs/sponsor-criteria.md`](sponsor-criteria.md). It overrides `docs/sponsors.md`.
Voloridge, Warp and SpaceXAI are in by decision; the angles that make LENS eligible are
in that file. MongoDB has no challenge; keep its blurb for the booth only.

## Priority order

| # | Gap | Prize it unlocks | Who | Prompt |
|---|---|---|---|---|
| 1 | Ladder engine never runs on the live camera; `/live` still 401s for judges | every demo | Claude session 1 | C1 |
| 2 | No dataset in the product; no Cursor trail; no Grok call | Voloridge, SpaceXAI | one human **in Cursor** | V1 |
| 3 | No Codex evidence at all — half the OpenAI score | OpenAI | Codex, driven by a human | O1 |
| 4 | Skip counter + token spend not rendered; no before/after number | Token Company | Codex (O1) then Claude | C3, T1 |
| 5 | Agent doc lists tools the hook lacks; agent can't read guide steps | ElevenLabs | Claude session 2 | C2 |
| 6 | Nothing in the tree is packaged as a developer tool | Warp | Devin | W1 |
| 7 | Keys are stubs; Elastic unconfigured; Deepgram never called | Elastic, Deepgram | Human + Claude session 4 | C4 |
| 8 | Virtual judging needs a Plume video + write-up | ElevenLabs, Long Lake, Ramp, Dropbox | Human | E1, S1 |
| 9 | Booth card, timeline, Cognition blurb are stale | Cognition | Devin | D2 |
| 10 | OpenAI blurb has no number | OpenAI | Devin | D3 |

Tool assignment matters for two sponsors: **Cursor** must build V1 (SpaceXAI counts only
Cursor commits) and **Codex** must build C3 (OpenAI scores Codex use). Do not swap them.

File ownership (so sessions run at once without conflicts):

- C1: `components/Camera/**`, `lib/store.ts`, delete `components/product/camera/CameraView.tsx`
- V1 (Cursor): `lib/objectives.ts` (new entries only), `lib/datasets/**`, `lib/grok.ts`,
  `app/api/datasets/**`, `components/product/data/**`, `fixtures/datasets/**`, one tab in
  `components/product/Workspace.tsx` and `WorkspaceNav.tsx`
- C2: `hooks/useAgent.ts`, `hooks/useStallWatch.ts`
- C3 (via Codex in O1): `components/product/**` except `camera/` and `data/`, `lib/persona.ts`, `lib/onboarding.ts`
- W1 (Devin): `scripts/boundary-check.ts`, `infra/warp/lens.yaml`, `demo/blurbs/07-warp.md`, `package.json` (one script line)
- C4: `.env.local`, `demo/blurbs/05,09`, `docs/sponsors.md`
- T1: `scripts/cost-report.ts`, `fixtures/*.jpg`, `demo/blurbs/09-token-company.md`
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
> 4. Repoint the Voloridge row of `docs/sponsors.md` at the data objective from V1
>    (`lib/datasets/`, `lib/objectives.ts`) and the Warp row at W1
>    (`scripts/boundary-check.ts`, the Guide extension). Rewrite blurb 10 once V1 has a
>    number; keep the benchmark as the leak-check evidence for the ladder, not as the
>    Voloridge claim.
>
> Scope: `.env.local` (never committed), `demo/blurbs/05,10`, `docs/sponsors.md`.

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
> - **Voloridge:** the data objective from V1 — which of their datasets, what the student
>   predicts, what the ladder caught. Lead with the insight line (the misconception the
>   dataset exposes), because "Insight" is a scored dimension.
> - **SpaceXAI:** name the Cursor branch, the Grok Imagine call in `lib/grok.ts`, the NASA
>   dataset, and whether Grok Bot was used for planning.
> - **Warp:** the boundary-check CLI (with the Devin bug it caught) and the Guide extension
>   walking a developer through a console. Say it is a developer tool first, a tutor second.
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
>    Credits line: OpenAI · Elastic · Dropbox · ElevenLabs · Cognition · The Token Company ·
>    Voloridge · Warp · SpaceXAI. Drop MongoDB (no challenge exists).
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

## V1 — The dataset objective: Voloridge and SpaceXAI in one build (Cursor, one human, ~4 h)

Build this **in Cursor, on branch `cursor/data-objective`, from the first commit**. SpaceXAI
counts Cursor usage; nothing built elsewhere helps. Plan it with Grok Bot first if you have
access (bonus points) and paste the plan into the PR body.

Paste this to Cursor:

> Repo: `apps/lens` (Next.js 16, App Router, Clerk, Zustand store in `lib/store.ts`, Mongo,
> vitest). Gate: `npm run typecheck` and `npm test`, both green. Read
> `docs/sponsor-criteria.md`, `lib/objectives.ts`, `lib/reasoning.ts` (only
> `analyzeReasoning` and its input type), `app/api/experiments/generate/route.ts`,
> `app/api/experiments/[id]/result/route.ts`, `components/product/camera/ExperimentCard.tsx`
> and `lib/sandbox.ts` (`runCode` runs Python through Piston). Do not modify any of those
> except `lib/objectives.ts`, where you only append entries.
>
> LENS names the belief behind a wrong prediction without stating the fix. Today its
> objectives are physical (gear train, LED). Add a **data objective**: the student reasons
> about a real public dataset, commits to a prediction, a real query runs, and the ladder
> in `analyzeReasoning` names the misconception. The dataset is the noise; the student is
> looking for the signal.
>
> 1. `lib/datasets/`: a small registry. Each dataset has `id`, `title`, `sourceUrl`, a
>    `fetch` note, a local CSV slice under `fixtures/datasets/<id>.csv` (≤ 2 MB, committed),
>    and a list of **questions**. Each question has the prompt text, a `predictionQuestion`
>    asked before the query runs, a Python snippet (pandas) that computes the true answer
>    from the slice, and 2–3 known wrong predictions each with the belief behind it and a
>    five-rung ladder in the same shape `lib/objectives.ts` uses (rung 0 is a question;
>    rung 4 has the fix; rungs 0–3 must pass `lib/leak-check.ts`). Ship two datasets:
>
>    - **NOAA ISD** (on the Voloridge list): one station, one year, hourly. Slice it with
>      their fetch script (`aws s3 sync --no-sign-request s3://voloridge-hack-mit-2026/src
>      ./src`, then `src/noaa_isd/fetch.py`) or straight from
>      `https://registry.opendata.aws/noaa-isd/`. Questions like "Is the day-to-day
>      temperature swing larger than the hour-to-hour swing in July?" and "Does wind
>      speed peak at the same hour as temperature?" — things people confidently get wrong.
>    - **NASA Exoplanet Archive** (space data, for SpaceXAI): the confirmed-planets table
>      (`https://exoplanetarchive.ipac.caltech.edu/`, TAP query, CSV). Questions like
>      "Are most known exoplanets bigger or smaller than Jupiter?" and "Do hot Jupiters
>      orbit closer than Mercury?" — the misconception is usually detection bias, which is
>      the insight a judge will remember.
>
> 2. `app/api/datasets/route.ts` (GET, list) and `app/api/datasets/run/route.ts` (POST):
>    takes `{ sessionId, datasetId, questionId, prediction }`, records a `prediction`
>    event through `lib/events.ts`, runs the snippet via `runCode` from `lib/sandbox.ts`
>    against the CSV (inline the CSV as stdin; do not write files), records the result as
>    an event, then calls `analyzeReasoning` with the objective text and the prediction so
>    the ladder fires. Auth: same `auth()` gate as `/api/experiments/generate`.
>
> 3. `lib/grok.ts`: one function, `generateReferenceImage(prompt)`, calling the xAI Grok
>    Imagine image endpoint with `XAI_API_KEY` (add to `.env.example` with a comment).
>    Use it in the run route to produce a reference chart image of the true answer (for
>    example "a histogram of exoplanet radii in Jupiter radii, log scale, minimal, no
>    text") and return its URL so the existing `compare_to_reference` flow has something
>    to show. If the key is unset, return `null` and say so in the response.
>
> 4. `components/product/data/DataObjective.tsx`: pick a dataset and question, show
>    `ExperimentCard` (reuse it, do not fork it), call the run route, then render the
>    ladder state exactly the way `components/product/reasoning/ReasoningGraph.tsx` does
>    (reuse the store's `reasoning` field). Add a "Data" tab in
>    `components/product/Workspace.tsx` and `WorkspaceNav.tsx`.
>
> 5. Tests: the registry test asserts every ladder passes `lib/leak-check.ts`, and every
>    snippet runs against its slice and returns a non-empty answer (skip the Piston test
>    when `PISTON_URL` is unreachable, and say so).
>
> PR body: which dataset, the slice size, one insight line per dataset (what the data
> says that people predict wrong), and the Grok Imagine call site. Keep every commit on
> this branch made from Cursor.

Voloridge also lends AWS compute at their booth. Not needed for a 2 MB slice; mention it in
the write-up only if you actually used it.

---

## W1 — Warp: package the developer tools that already exist (Devin, ~1.5 h)

> Read `AGENTS.md`, then `docs/sponsor-criteria.md` §Warp. Warp judges "Best Developer
> Tool": something that improves the developer experience. Two things in the tree qualify
> and neither is packaged.
>
> 1. **The boundary check.** `lib/server-boundary.test.ts` fails when a `"use client"`
>    file can reach the Mongo driver or a server secret through value imports. It caught
>    a real bug (PR #12 pulled the driver into the browser bundle). Extract the walker
>    into `scripts/boundary-check.ts`, a CLI any Next.js App Router repo can run:
>    `npx tsx scripts/boundary-check.ts [--root .] [--forbid mongodb,@clerk/nextjs/server]
>    [--json]`. Exit 1 with a readable import chain on a violation (`hooks/x.ts →
>    lib/y.ts → mongodb`). Keep the vitest file as a thin wrapper that calls the same
>    function so `npm test` still guards the repo. Add `"boundary": "tsx
>    scripts/boundary-check.ts"` to `package.json` scripts. Tests: one passing tree, one
>    failing tree built from fixture strings.
> 2. **Warp workflows.** Rewrite `infra/warp/lens.yaml` for the app that runs; every line
>    verified against `apps/lens/package.json`: `lens dev`, `lens db setup`, `lens elastic
>    up` (docker compose line from `apps/lens/README.md`), `lens boundary`, `lens test`
>    (`npm run typecheck && npm test`), `lens cost report` (`npx tsx scripts/cost-report.ts`
>    if it exists on main, else omit), `lens demo token` (curl to `POST /api/demo/token`).
> 3. Rewrite `demo/blurbs/07-warp.md`: developer tool first. Two sentences on the
>    boundary check (with the bug it caught), one on the LENS Guide extension walking a
>    developer through an unfamiliar console (`extension/`, `app/api/guide/step`), one
>    on the workflows.
>
> Scope: `scripts/boundary-check.ts`, `lib/server-boundary.test.ts` (wrapper only),
> `package.json` (one line), `infra/warp/lens.yaml`, `demo/blurbs/07-warp.md`, tests.
