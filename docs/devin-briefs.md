# Overnight agent briefs

Paste-ready task briefs for Devin sessions. Repo rules live in [`AGENTS.md`](../AGENTS.md);
these briefs only say what is specific to the task.

**Round 1 (PRs #2–#7) ran against the pre-repoint tree and is mostly superseded.** The sponsor
map now points at `apps/lens/`, which is the app that actually runs. Everything below targets
that tree.

Two rules for launching:
- Each brief touches disjoint files **except** B and D, which both add a dependency to
  `apps/lens/package.json`. Launch B first, or expect one trivial lockfile conflict.
- The verification bar in `apps/lens` is `npm run typecheck`. There is no test runner there
  until brief B adds one.

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

## Round 1 disposition

| PR | Verdict |
|---|---|
| #2 web lockfile | close — `apps/web` has never been installed |
| #3 vite env types | close — same tree |
| #4 sponsor blurbs | close, re-run as **brief A** — every path points at the dead tree |
| #5 contract validation | ✅ merged (`4931bca`) |
| #6 shrinker/ladder tests | ✅ merged (`788fb53`) |
| #7 benchmark dataset | close — duplicates the real benchmark in `apps/lens` |

## Morning review

1. `gh pr checkout <n>`, run the gate (`npm run typecheck` in `apps/lens`, or `make test` in
   `services/`), then read the diff. Red closes.
2. Read the "out of scope" line in each PR body first — that is where the real findings are.
3. Log each one in `docs/devin-log.md`: brief, PR number, merged or closed, what it caught.
4. Fill `demo/blurbs/11-cognition.md` with the honest numbers: opened, merged, closed.
