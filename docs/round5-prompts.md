# Round 5 — what is left, and the prompt for each

State when written (2026-09-20 ~04:45 EDT). `main` = `866f367` plus this file. Everything
below assumes it. Gate for every PR: from `apps/lens`, `npm run typecheck` and
`npm test` (197 tests), both green. Push to `main` at every stopping point — Isha asked
for that explicitly.

Read first: [`sponsor-criteria.md`](sponsor-criteria.md) (what each sponsor judges),
`demo/blurbs/README.md` (rule: no blurb claims what is not wired).

## What is true right now (audited, not assumed)

| Sponsor | State | Evidence |
|---|---|---|
| OpenAI | built, **not on the submission form** | Codex section in `demo/blurbs/01-openai.md` (PR #20); real latency p50 1203 / p95 1776 ms over 265 frames |
| ElevenLabs | works; agent goes off-topic | verified live tonight; `ELEVENLABS_AGENT.md` has no scope rule; Plume video not done |
| Deepgram | verified | PR #25; 5 stamped `voice_turn` docs in Mongo |
| Voloridge | verified in-app | Data tab ran a real NOAA query |
| SpaceXAI | verified in-app | Grok Imagine chart rendered from `imgen.x.ai`; Cursor co-author trail on the NASA commits |
| Warp | verified | `npm run boundary` → `✓ boundary clean (56 client entries, 158 files scanned)` |
| Cognition | docs merged | PR #23 |
| Long Lake, Ramp | paragraphs written | `demo/submissions.md`; form description is empty |
| Dropbox | **placeholder token** | `DROPBOX_ACCESS_TOKEN` is `…`; blurb 04 and the submission paragraph claim it |
| Elastic | **not running** | `ELASTIC_URL` unset; no Docker on this Mac; blurbs 02/03 claim it |
| Token Company | **no number** | 34 `model_call`, 1 `model_call_skipped`, zero token payloads; "Tokens spent" shows nothing real |
| Arrowstreet, Meta, Hackster, GiveCampus | nothing built | selected on the form anyway; criteria file says not applicable |

Keys (Isha adds; agents leave placeholders alone): `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`
(Gemini is `LLM_PRIMARY` — every ladder call is on the gpt-4o-mini fallback until this is
set), `DROPBOX_ACCESS_TOKEN`, `ELASTIC_URL` (needs Elastic Cloud; local is impossible).

## Priority order

| # | Gap | Prize | Who | Prompt |
|---|---|---|---|---|
| 1 | Form: OpenAI missing, description empty, four dead sponsors ticked | OpenAI + all | **Isha, 5 min** | F1 |
| 2 | Agent answers anything; no scope rule in the prompt | ElevenLabs | **Isha in the ElevenLabs console** | A1 |
| 3 | No before/after number | Token Company | Claude or Devin | T1 |
| 4 | Two things shipped without a live proof: Deepgram turns attaching to the session, "stop session" by voice | Deepgram, demo | Isha + Claude, 2 min | V1 |
| 5 | Elastic claimed, not running | Elastic | Isha decides, then Claude | E1 |
| 6 | Dropbox claimed, not configured | Dropbox | Isha (token), then Claude runs `scripts/dropbox-check.ts` | — |
| 7 | Plume video + write-up | ElevenLabs, Long Lake, Ramp, Dropbox | Isha | see round4 E1 |
| 8 | Nano Banana (Gemini image gen) — asked for, undefined | — | Claude, after Isha says what it draws and where | N1 |
| 9 | CameraView and PointerView each own a `useAgent` | polish | Claude, needs daylight | U1 |
| 10 | Six stale branches, one 3.5k-line orphan | hygiene | Claude | B1 |

## F1 — The submission form (Isha)

Add **OpenAI — 5th Teammate** to the sponsor challenges. Paste the matching paragraphs
from `demo/submissions.md` into the description. Untick Arrowstreet, Meta, Hackster and
GiveCampus unless you want them there as noise — nothing in the tree supports them.

## A1 — Keep LENS on topic (Isha, ElevenLabs console, 5 min)

The live transcript tonight had LENS discussing deployment timelines and stress
management. `apps/lens/ELEVENLABS_AGENT.md` has no scope rule. Add one paragraph to the
agent's system prompt in the ElevenLabs console, and the same paragraph to the .md:

> You tutor what is in front of the camera and nothing else. If the student asks about
> anything unrelated — their schedule, their feelings, a deployment, your sponsors — say
> in one short sentence that you only help with the work in front of you, then ask what
> they are working on. Never answer the unrelated question. When the student refers to
> something visible ("this", "my hand", "here", "look"), call analyze_workspace before
> replying instead of asking them to describe it.

The second sentence is also the fix for "I had to tell it to look ten times".

## T1 — The Token Company number (Claude Code or Devin, ~45 min)

> Repo: `apps/lens`. Read `lib/frame-cascade.ts`, `lib/token-ledger.ts`, `lib/metrics.ts`
> and `components/product/MetricsStrip.tsx` first. Gate: typecheck + test green.
>
> The challenge wants the most creative cost saving *inside the product* with a
> before/after number. The mechanism exists: `lib/frame-cascade.ts` skips a vision call
> when the scene has not changed, and `lib/token-ledger.ts` can record token spend. Tonight's
> Mongo has 34 `model_call` events, 1 `model_call_skipped`, and **no event carries a token
> count**, so "Tokens spent" on the strip reads 0.
>
> 1. Make every `/api/vision/analyze` and `/api/reasoning/analyze` call write its usage
>    (prompt + completion tokens from the provider response) through the ledger onto the
>    `model_call` event it already emits. Do not estimate; read the provider's usage field.
> 2. Write `scripts/cost-report.ts`: replays the `fixtures/*.jpg` frames through the
>    cascade twice — once with the skip heuristic off, once on — and prints calls made,
>    calls skipped, tokens spent, and dollars at the model's list price. That is the
>    before/after.
> 3. Put the two numbers in `demo/blurbs/09-token-company.md` and take it off "hold" in
>    `demo/blurbs/README.md`.
>
> Scope: `lib/token-ledger.ts`, `lib/metrics.ts`, the two analyze routes, the new script,
> the blurb. Do not touch `components/Camera/`, `hooks/`, `lib/reasoning.ts`.

## V1 — Two live proofs (Isha talking, Claude watching, 2 min)

Both shipped tonight without a spoken session to verify against. Sign in, open `/app`,
Camera tab, follow `apps/lens/demo/think-aloud-test.md` steps 3 and 4. Then, with a session
running, say "stop session". Expected: the session ends without a click, and every
Deepgram `voice_turn` from the sitting shares one `sessionId`. If either fails, the
code is in `components/Camera/CameraView.tsx` — `persistThinkAloud` and the transcript
effect above `endSession`.

## E1 — Elastic: run it or stop claiming it (Isha decides, Claude does)

There is no Docker on this Mac and no compose file. Either:
- **Run it:** create an Elastic Cloud deployment, set `ELASTIC_URL` and `ELASTIC_API_KEY`
  in `.env.local`; Claude then runs one ingest and confirms `lib/elastic.ts` indexes
  land, or
- **Stop claiming it:** Claude rewrites `demo/blurbs/02-elastic-memory.md` and
  `03-elastic-search.md` to say what Atlas `vectorSearch` does today, and drops the
  Elastic paragraph from `demo/submissions.md`.

A judge who checks a claimed integration and finds nothing is worse than no entry.

## N1 — Nano Banana (Claude, blocked on a sentence from Isha)

Isha asked for Gemini image generation ("Nano Banana", `gemini-2.5-flash-image`). Nothing
on any branch generates images with Gemini. Needed before building: what it draws and
where it shows. The obvious fit is the same slot Grok fills in the Data tab
(`lib/grok.ts` → `referenceImageUrl` in `app/api/datasets/run/route.ts`) — but SpaceXAI
requires the Grok call, so Gemini would have to be a fallback or a second surface
(Study tools?). Do not build until that is decided.

## U1 — One agent (Claude, ~2 h, not at 4 a.m.)

`components/Camera/CameraView.tsx:588` and `components/product/camera/PointerView.tsx:37`
each call `useAgent(...)` with their own client tools. Only one mounts at a time so it
is not a live bug, but it is the last duplicated feature: two Start/End controls, two
transcripts, two mic prompts. Lift one `useAgent` to `app/app/page.tsx` (inside the
existing `ConversationProvider`), pass it down, and register both tool sets on it.
Scope includes `hooks/useAgent.ts`. Verify with a real session in both modes.

## B1 — Branch hygiene (Claude, 10 min)

Delete, all already on `main` or superseded: `claude/ladder-live-camera`,
`devin/sponsor-blurbs`, `gnana35/peach-theme-and-onboarding`,
`claude/data-objective-noaa`, `devin/vite-env-types`, `devin/1789866162-web-lockfile`,
`deepgram-think-aloud`. Ask Isha about `claude/orchestrator-sources-memory` (3.5k lines,
Sora video summaries, second Deepgram path, conflicts in 3 files) and
`sam/reasoning-sources` (concept-map rewrite, clean) before touching either.

## Known rough edges, documented, not blocking

- Think-aloud mic race: toggling at the instant the ElevenLabs SDK seizes the mic yields
  a silent recorder and a `1011` close ~10 s later. Fix belongs in `lib/deepgram.ts`.
- Think-aloud error line replaces the control until reload (as specified; one recoverable
  timeout ends the feature for the session).
- `lib/vision.ts:59` pins `gpt-4o-2024-08-06` with no env override; `lib/grok.ts:12` pins
  `grok-imagine-image` the same way.
- `components/teacher/AvailabilityHeatmap.tsx` renders `TOTAL_STUDENTS = 32` of placeholder
  data.
- Telemetry is behind `?debug=1` or `localStorage.setItem("lens:debug","1")`.
