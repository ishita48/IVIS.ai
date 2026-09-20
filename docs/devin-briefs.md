# Overnight agent briefs

Paste-ready task briefs for Devin sessions. Repo rules live in [`AGENTS.md`](../AGENTS.md);
these briefs only say what is specific to the task.
Ownership and current state: [`docs/agent-coordination.md`](agent-coordination.md).

**State at the time of writing:** rounds 1–2 (briefs A–E) are merged. PR #12 broke the
build by pulling the Mongo driver into a client bundle; fixed in `34934cb`. There is now a
static boundary test, `lib/server-boundary.test.ts`, that fails if a `"use client"` file can
reach Mongo or a server secret through value imports. **It is part of `npm test` and it must
stay green** — a red boundary test is a demo outage.

**Round 3 is briefs F, G, H, J below.** They target the things that actually differentiate
LENS at judging — the enforced no-answer ladder, prediction-before-reveal on the gear train,
and the camera cascade — not sponsor logos. Read `docs/agent-coordination.md` first.

Launch rules for round 3:
- All four are independent and can run at once.
- **H and J both add one line to `app/api/vision/analyze/route.ts`** on different lines; git
  should merge it, and if not the conflict is trivial. Merge H first.
- **F and G both touch `lib/lens/contracts.ts`** (a type each). Same story.
- The bar in `apps/lens` is `npm run typecheck` **and** `npm test` (vitest, includes the
  boundary test). No key on your machine can run a model; do not mock a score.

---

## A — Sponsor blurbs, v2

> Fill every file in `demo/blurbs/`. Round 1 of this task wrote them against the old
> architecture and all of it is wrong — you are replacing that work, not extending it.
>
> Read `docs/sponsors.md` first. It was rewritten: **the demo runs out of `apps/lens/`**, and
> anything under `services/` or `apps/web/` is the earlier architecture that is not on the
> demo path. Every path you cite must be inside `apps/lens/` (or `infra/` for Warp). If you
> find yourself about to write `services/...` in a blurb, you are reading the wrong tree.
>
> For each sponsor, open the file `docs/sponsors.md` names and read the real code before you
> write a word about it.
>
> Changes from round 1:
> - **Add `13-mongodb.md`.** MongoDB is a sponsor and was missing. It is used in ~27 files —
>   sessions, events, reasoning state, aggregations. Start at `apps/lens/lib/mongodb.ts` and
>   `apps/lens/lib/metrics.ts`, which computes judge-facing numbers as live aggregations.
> - **Do not create `08-asus.md`.** ASUS was dropped; there is no hardware. If that file
>   exists in your branch, delete it.
> - **`05-deepgram.md` and `09-token-company.md`:** leave both as the empty template. They are
>   pending a wiring decision and must not be claimed yet.
> - **`02-elastic-memory.md`:** the kNN memory is real — `apps/lens/lib/elastic.ts` has a `knn`
>   query block and a dedicated `lens-reasoning` index. Write it from that code.
> - **`11-cognition.md`:** leave as the template. A human fills it with session counts.
>
> Rules are in `demo/blurbs/README.md`: 2–4 sentences, lead with what it does for a student
> rather than that we used the sponsor, one concrete number or path each. Naming a file that
> does not exist, or claiming an integration that is not wired, gets the PR closed. If the
> code is thinner than the map claims, say so in the PR body and write only what is true.
>
> Scope: `demo/blurbs/*.md` only. No code.

---

## B — Voloridge: make the benchmark quotable

> The 20-bug benchmark already exists and works: `apps/lens/scripts/bench.ts` (209 lines) with
> its corpus in `apps/lens/fixtures/bugs.json` (20 cases). Do not rebuild it. Round 1 built a
> duplicate in `services/brain/bench/` against the dead tree; ignore that entirely.
>
> The problem is that nothing proves the number. Three things:
>
> 1. **Add a test runner.** `apps/lens` has none — no vitest, no jest, no test files. Add
>    vitest, a `vitest.config.ts`, and a `"test": "vitest run"` script. This is the one new
>    dependency allowed.
> 2. **Test the deterministic half.** `deterministicLeakCheck` and `verifyCorpus` in
>    `bench.ts` are pure functions and need no API key. Cover them properly: a response that
>    leaks the fix verbatim, one that leaks a fragment, one that leaks a direct instruction,
>    an empty response, and a safe response that mentions the topic without giving the fix.
>    Leak detection is the entire claim the benchmark makes — if it over-fires, the number is
>    meaningless in our favour, which is worse than it being low.
> 3. **Write the result somewhere.** Add a `--out <path>` flag that writes the summary as
>    JSON, so a human with a real `OPENAI_API_KEY` can run it once and have a file to quote.
>
> You have no `OPENAI_API_KEY`, so you cannot run the benchmark end to end. Do not try, and
> do not mock the model to fake a number.
>
> Verify with `npm run typecheck` and your new `npm test`. Scope: `apps/lens/scripts/bench.ts`,
> a new test file, `vitest.config.ts`, `package.json`.

---

## C — Token Company: the token ledger

> `demo/script.md` at **2:15** is a 25-second beat where the presenter points at the header
> and says "eleven model calls skipped." That number does not exist in `apps/lens`. Build it.
>
> **Read this before you start.** A grep of `apps/lens` finds no skip path at all — nothing
> currently declines to call a model. So this is not a port of the old `cascade.py`; do not
> copy that file. Your job is the ledger and the instrumentation, not the product decision
> about when to skip.
>
> Three pieces:
>
> 1. **`apps/lens/lib/token-ledger.ts`** — `recordCall()` and `recordSkip()`, persisted
>    through the existing events collection. Read `apps/lens/lib/events.ts` and
>    `apps/lens/lib/mongodb.ts` first and follow their shapes; do not invent a new collection.
> 2. **Instrument the real call sites.** Grep for the OpenAI, Anthropic, and Gemini clients in
>    `apps/lens/lib/` and call `recordCall()` at each. A ledger nothing writes to is worthless.
> 3. **Surface it in `apps/lens/lib/metrics.ts`.** That file already computes the metrics strip
>    as live aggregations over `events` and `reasoning_states`, with a comment insisting the
>    numbers are query results and not constants. Add `modelCallsSkipped` and `tokensSpent` the
>    same way. Do not break the existing shape.
>
> **Do not build or mount UI.** `apps/lens/components/MetricsStrip.tsx` is where a human will
> render this; say so in your PR body and stop there.
>
> Expect `modelCallsSkipped` to read 0 until a human adds a real skip path. That is the correct
> and honest result — say it plainly in the PR rather than manufacturing a number.
>
> Verify with `npm run typecheck`. Scope: `lib/token-ledger.ts`, `lib/metrics.ts`, and minimal
> edits at the call sites you instrument.

## D — Deepgram: think-aloud in the shipping app

> Deepgram is on the sponsor list but exists only in `apps/web/`, which never runs, so we
> cannot currently claim it. Port it.
>
> Read the old implementation at `apps/web/src/voice/deepgram.ts` for the intent — streaming
> mic audio to Deepgram over a websocket, with each final utterance stamped against whatever
> the student was doing when it started. Rebuild that as `apps/lens/lib/deepgram.ts` plus a
> token/auth route at `apps/lens/app/api/deepgram/route.ts`, following the shape of
> `apps/lens/app/api/elevenlabs/signed-url/route.ts`, which solves the same problem for the
> other voice vendor. Persist utterances through the existing events collection.
>
> **Do not build the UI or touch any hook.** Module and route only; say in the PR body where a
> human should mount it.
>
> **Build the stamping, not the socket.** ElevenLabs already transcribes the student — a second
> raw transcriber on the same audio is a dependency with no new capability. The thing worth
> having is each final utterance stamped against the analyze/vision call that was in flight
> when it started. If you ship only the transcript stream, this task failed.
>
> **Known hazard: mic contention.** `apps/lens/hooks/useAgent.ts:320` takes
> `getUserMedia({audio:true})` and the ElevenLabs SDK then owns the live mic over WebRTC. A
> second `MediaRecorder` stream works in Chrome but double-captures the same audio during a
> live conversation. Write the module so a human can test it with an ElevenLabs session
> actually running, and call the risk out in your PR body. Do not touch `useAgent.ts`.
>
> Be honest about the ceiling here: there is no `DEEPGRAM_API_KEY` on your machine, so you can
> typecheck this but you cannot prove it works. Say that plainly in the PR. A human verifies
> with a real key before anyone claims the integration.
>
> Verify with `npm run typecheck`. Scope: the two new files, `package.json`, `.env.example`.

---

## E — Voloridge: make the benchmark actually run

> **Depends on brief B being merged first.** B added vitest and the corpus tests you will use
> to verify this. Branch from a `main` that already contains it.
>
> The 20-bug benchmark has never produced a number. Three defects, all confirmed:
>
> 1. **Broken import.** `apps/lens/scripts/bench.ts:2` imports `analyze` from
>    `../lib/reasoning`. That export does not exist — the function is `analyzeReasoning`
>    (`lib/reasoning.ts:90`). Read its `AnalyzeReasoningInput` type and adapt the call site at
>    line 174 to match. Do not change `lib/reasoning.ts`; the engine is correct and other code
>    depends on it.
> 2. **Array comparison.** `verifyCorpus()` aborts at `bug-03`: a result of `[1, 2]`
>    stringifies to `1,2` and is compared against the literal string `[1, 2]`. Normalize both
>    sides before comparing, rather than editing the fixtures to match a stringify quirk.
> 3. **Four cases are not bugs.** These have `expected === actual`, so the "buggy" code passes:
>    `bug-03-mutation-while-iterating`, `bug-11-shallow-copy`, `bug-17-palindrome`,
>    `bug-20-all-zeros`. Replace all four with real ones. The corpus must still be exactly 20.
>
> Replacement cases follow the same rules the existing corpus does: the fix is small, the bug
> is a reasoning error rather than a typo or a missing import, and a plain LLM could
> plausibly get it right. No stacked strawmen — a benchmark we win by rigging is worth less
> than a low honest number.
>
> You have no `OPENAI_API_KEY`, so you cannot run the benchmark end to end and must not mock a
> model to fake a score. Your bar is: `verifyCorpus()` passes on all 20 cases, `npm test` is
> green including B's corpus tests, and `npm run typecheck` passes. Say plainly in the PR that
> the live run is unverified and a human with a key has to produce the number.
>
> `npm run lint` is broken repo-wide — it calls the removed `next lint`. Not your task; ignore
> it and do not fix it.
>
> Scope: `apps/lens/scripts/bench.ts`, `apps/lens/fixtures/bugs.json`, and B's test file if a
> replacement case needs a new assertion.

## F — The gear train knows what you got wrong

> LENS's whole claim is that it names the *belief* behind a mistake without stating the
> fix. On stage that only works if the model has something specific to point at. Today the
> ladder is generated freeform per call; a judge who predicts "3×" on the gear train gets
> whatever the model improvises. Make it deterministic for the demo objects.
>
> Read `hardware/README.md` first. It documents the prop exactly: a two-stage compound
> train, 30T→10T then 30T→10T, so the output turns **nine** times per crank turn. Nearly
> everyone predicts 3× or 6× (they add the stages instead of multiplying), and most also
> predict the output reverses (two meshes means two reversals — it turns the *same* way as
> the crank). Those are the misconceptions this brief encodes.
>
> Build `lib/objectives.ts`: a registry of demo objectives. Each has an `id`, the `objective`
> text the client sends, a `lookFor` note for the vision prompt, and a list of known
> misconceptions — each with the wrong prediction(s) that reveal it, the belief behind it,
> and a five-rung ladder authored to the existing `reveals` levels: `nothing` (rung 0 is a
> **question**), `location`, `cause`, `strategy`, `fix`. Ship three objectives: the gear
> train (ratio *and* direction), a soldering placement (component in the wrong row /
> reversed polarity), and one paper worked-problem of your choosing. The gear train is the
> one that must be perfect.
>
> Wire it into `lib/reasoning.ts`: when the active objective matches a registry entry and the
> student's recorded prediction matches a known wrong prediction, `analyzeReasoning` uses the
> curated ladder instead of generating one. Redaction by unlocked level is unchanged — the
> server still withholds locked rungs exactly as it does now. Read `analyzeReasoning` and
> `AnalyzeReasoningInput` carefully to find where prediction and objective arrive; do not
> change the redaction code. Do **not** touch `lib/vision.ts` — another session owns it
> tonight — so if you need `lookFor` in the vision prompt, expose it from the registry and
> say in the PR where a human should read it.
>
> Move `deterministicLeakCheck` out of `scripts/bench.ts` into `lib/leak-check.ts` and import
> it from both the bench and a new registry test. The test asserts, for every objective and
> misconception: rung 0 is a question, rung 4 contains the fix, and **no rung below 4 leaks
> it** by the same checker the benchmark uses. That is the product's thesis applied to its own
> demo content, and it is the line you should lead the PR body with.
>
> Add `GET /api/objectives` returning the registry without the ladders (ids, titles,
> objective text) so a human can add a picker later. No UI.
>
> Scope: `lib/objectives.ts`, `lib/leak-check.ts`, `lib/reasoning.ts` (wiring only),
> `scripts/bench.ts` (the import move), `lib/lens/contracts.ts` (types), `app/api/objectives/`,
> tests.

---

## G — The voice agent can see what the extension sees

> The voice agent and the screen guide are two loops that never touch. The agent's client
> tools are `analyze_workspace` and `record_prediction` (`hooks/useAgent.ts`); the extension
> calls `/api/guide/step` on its own and nothing persists the result. So "ask it through
> voice while the extension is guiding you" does not exist. Build the server half.
>
> `app/api/guide/step/route.ts` already resolves a session (`resolveOrCreateSession(userId,
> body.sessionId, "LENS Guide")`). After each step, persist it through `recordEvent` in
> `lib/events.ts` as a new `guide_step` event type (add it to `LensEventType` in
> `lib/lens/contracts.ts`; follow the existing shapes — do not invent a collection). Store the
> goal, the step text, the `why` question, status, and the target coordinates if present.
>
> Add `lib/guide-state.ts` with `latestGuideStep(sessionId)` and `guideHistory(sessionId,
> limit)` reading those events, and `GET /api/guide/state?sessionId=` returning the latest
> step plus the last few. Auth-gate it exactly like `/api/guide/step`.
>
> **Do not touch `hooks/useAgent.ts`, `components/`, or `extension/`.** End the PR body with
> the one paragraph a human needs: the name and JSON shape of a `read_guide_step` client tool
> to register in `useAgent.ts` so the ElevenLabs agent can answer "what do I do next?" from the
> guide's own state. That is a five-line human change once your endpoint exists.
>
> Verify with `npm run typecheck` and `npm test`. Scope: `lib/guide-state.ts`,
> `lib/lens/contracts.ts`, `app/api/guide/step/route.ts` (the persist call), `app/api/guide/state/`,
> tests for the state reader against fixture events.

---

## H — A judge can use `/live` without an account

> `/live` is public in `middleware.ts` — the comment says so explicitly — but every route it
> needs (`/api/vision/analyze`, `/api/pointer/screen`, `/api/guide/step`) has its own
> `const { userId } = await auth(); if (!userId) return 401` gate. So a judge opening `/live`
> on their phone gets **401 on Analyze**. Nobody noticed because every developer was signed in.
>
> Do not just delete the gates: these routes spend OpenAI and Anthropic credits. Build a
> **rate-limited demo path that is off by default.**
>
> - `lib/demo-access.ts`: `resolveCaller(req)` returns `{ userId, demo: false }` for a Clerk
>   session, or `{ userId: "demo:<id>", demo: true }` for a valid demo token, else `null`.
>   Demo tokens are HMAC-signed with a `DEMO_TOKEN_SECRET` env var, short-lived (30 min), and
>   only honoured when `DEMO_MODE=1`. Add both to `.env.example` with a comment.
> - `POST /api/demo/token`: issues a token, capped in memory at N analyses per token and M
>   tokens per IP per hour (pick sane numbers, make them env-tunable, document them). Returns
>   404 unless `DEMO_MODE=1`.
> - In the three routes, replace the inline gate with `resolveCaller`. Signed-in behaviour is
>   byte-for-byte unchanged; that is the acceptance test. Demo callers get a session under the
>   `demo:` user id so events still record.
>
> **Do not touch `components/` or `middleware.ts`.** The `/live` client has to send the token
> as a bearer header; say in the PR body exactly which fetch in
> `components/Camera/CameraView.tsx` a human adds it to. Until they do, nothing changes.
>
> Lead the PR body with the cap numbers and the env switch. This PR changes who can spend
> money; the reviewer must be able to see the limits without reading code.
>
> Verify with `npm run typecheck` and `npm test`, including tests for token issue/verify/expiry
> and the per-token cap. Scope: `lib/demo-access.ts`, `app/api/demo/token/`, the three routes
> (gate line only), `.env.example`, tests.

---

## J — The model only wakes when something changed

> The 2:15 beat says "eleven model calls skipped." Brief C built the ledger and it honestly
> reads **0**, because nothing in `apps/lens` ever declines a model call. Give the camera path a
> real cascade rule, so the number is true.
>
> Read `lib/token-ledger.ts` first for the real `recordSkip` API, then `lib/vision.ts` for
> the function `app/api/vision/analyze/route.ts` calls. Add `lib/frame-cascade.ts` and call it
> from inside that vision function **before** any model call. It skips — returning the prior
> observation with `skipped: true` and a reason, and recording the skip in the ledger — when:
>
> 1. the frame bytes are identical to the last analysed frame for this session and objective
>    (hash the data URL; keep a small in-memory LRU keyed by session), or
> 2. the client reports `sceneChanged: false` (an optional request field you add — the client
>    already runs a stall/motion watcher, a human wires the flag later), or
> 3. the objective is unchanged, a prior observation exists, and the last real call was under
>    a throttle window (default 4000 ms, env-tunable). This is the honest version of "the
>    checker decides before the model wakes": nothing changed, so there is nothing new to say.
>
> A real model call always happens when the objective changes or the client explicitly asks
> with `force: true`. Forward the two optional fields through the route in one line; **H
> touches the same file on a different line**, so keep your edit to that one line.
>
> Do not change the ledger's shape, `metrics.ts`, or any component. `modelCallsSkipped` in
> the metrics strip should start moving on its own once this merges and a session runs.
>
> Verify with `npm run typecheck` and `npm test`, with unit tests for all three rules and for
> `force`. Scope: `lib/frame-cascade.ts`, `lib/vision.ts` (the call), the one route line, tests.

---

## Round 1 disposition

| PR | Verdict |
|---|---|
| #2 web lockfile | close — `apps/web` has never been installed |
| #3 vite env types | close — same tree |
| #4 sponsor blurbs | close, re-run as **brief A** — every path points at the dead tree |
| #5 contract validation | ✅ merged (`4931bca`) |
| #6 shrinker/ladder tests | ✅ merged (`788fb53`) |
| #7 benchmark dataset | closed — duplicated the real benchmark in `apps/lens` |
| #8 brief B (vitest + bench checks) | ✅ merged (`5cc735b`) |
| #9 brief A blurbs v2 | ✅ merged |
| #10 brief D Deepgram | ✅ merged — unverified without a key, still unclaimed |
| #11 brief E benchmark | ✅ merged — corpus validates all 20 |
| #12 brief C token ledger | ✅ merged — **broke the client bundle**, fixed in `34934cb`; `modelCallsSkipped` reads 0 until brief J |

## Morning review

1. `gh pr checkout <n>`, run the gate (`npm run typecheck` in `apps/lens`, or `make test` in
   `services/`), then read the diff. Red closes.
2. Read the "out of scope" line in each PR body first — that is where the real findings are.
3. Log each one in `docs/devin-log.md`: brief, PR number, merged or closed, what it caught.
4. Fill `demo/blurbs/11-cognition.md` with the honest numbers: opened, merged, closed.
