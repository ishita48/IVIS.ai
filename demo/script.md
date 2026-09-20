# Demo script — 3 minutes

Rehearse twice. The second rehearsal is where you find the dead wifi problem.

> **Rewritten against the running app on 2026-09-19.** The previous version of this
> file described the `apps/web` code-editor tutor: an editor with a buggy Kadane, a
> typed predict box, a gap box, a click-to-reveal five-rung ladder, a source card and a
> skipped-model-call counter in the header. None of those surfaces exist in `apps/lens`,
> which is the app that runs. What survives, and why, is recorded in **Cut beats** at the
> bottom — read it before you re-add anything.

## Before you start

- Be **signed in to `/app` already**. The workspace is behind Clerk; there is no
  sign-in beat in a 3-minute demo. The camera is the Camera tab of the workspace —
  there is no separate live page.
- Camera permission already granted for `localhost:3000`.
- A physical object on the desk worth pointing at — a circuit, a worked problem on
  paper, a lab bench. Something with a visible mistake in it.
- The metrics strip is in the TopBar, so it is on screen for the whole demo without
  anyone navigating anywhere.

## 0:00 — the one idea (20s)
> "Every AI tutor sees the question. This one sees the attempt. It watches what you're
> actually doing, and it is built so that it *cannot* hand you the answer — that's
> enforced on the server, not asked for in a prompt. Watch."

Camera tab already open. **Do not start the session live** — start it in the last
seconds of the intro so the greeting lands on time.

## 0:20 — it looks only when it needs to (30s)
Start the session. Say something.

> "It greets you and then it waits. It is not streaming frames to an API — it decides
> on its own when it needs to look. Frames are analyzed on demand and never stored;
> only the derived text observation leaves the machine."

That claim is real and it is worth saying slowly — it is the one every judge with a
privacy instinct is waiting for.

## 0:50 — a real look, and a question (35s)
Hit **Analyze**.

> "One frame, one real vision call, structured JSON back. It draws a box around the one
> thing that matters — and then it asks a question instead of telling me what's wrong."

Point at the box on the video feed. Read the question aloud. **Do not answer it.**

This is the P0 loop and it is the whole demo. If everything after this dies, you have
still shown the product.

## 1:25 — the judge predicts (30s)
Turn the laptop. The **Before you touch it — predict** card is on the Camera card with
one question and four answers. Hand the object to the judge and let *them* pick. Most
pick "3 times". Do not react.

> "You just committed to an outcome before you acted. That's recorded as a prediction
> event — the same event I'd get if you'd said it out loud — and every number on that
> strip is a query over those events, not a counter someone incremented."

The card does not say whether they were right. Watch the **Hint ladder** under it: one
rung lights with the exact sentence LENS chose, and the rungs above it read *not
generated*. If the judge answered "9 times", the ladder stays at Point and you say so —
"you didn't need a hint, so none was generated" is still the thesis.

## 1:55 — change one thing, look again (30s)
Turn the crank / change the thing on the desk. Hit **Look** again.

> "New frame — and it already knows what it saw last time. The previous observation goes
> into this call, so it isn't describing the scene from scratch, it's telling me what
> changed against what I predicted."

That threading is real: `priorObservation` is passed on every re-analyze and updated
from the result. **Optional, and only if you have rehearsed it:** loading a reference
video unlocks `compare_to_reference`, a genuine two-image comparison — but it needs a
file loaded ahead of time and the agent has to choose to call it. Do not put a tool call
you don't control on the critical path of a 3-minute demo.

## 2:25 — the ladder is enforced, not requested (20s)
Stay on the Camera card. Point at the **Hint ladder**: lit rungs show the sentence LENS
said, the row above reads *not generated · 1 more attempt*.

> "Five rungs: point, ask, nudge, experiment, explain. The model doesn't get to pick.
> The server computes the deepest rung I've actually earned from my event history and
> caps the response there. It can't jump to the answer because it's impatient — the text
> for the rung I haven't reached *has not been generated*."

`lib/reasoning.ts` — `nextAllowedLevel` reads the events, `capLevel` clamps the model's
choice. If a judge asks, open it. This is the strongest true claim in the demo.

## 2:45 — the number (15s)
Point at the strip.

> "Direct answers given: zero. Not a design goal — a query result, live, over everything
> that happened in the last three minutes."

## Close
> "It sees the attempt, not the question. It asks before it explains. And it can't skip
> to the answer, because the server won't let it."

(The old close — "the checker decides, the model explains" — came from the `apps/web`
proof-engine architecture. There is no cheap checker gating the model in `apps/lens`;
the thing doing the gating is the ladder cap. Don't say the old line.)

---

## The benchmark — do not say this on stage yet

`make bench` used to run the dead `services/brain` tree; it now runs the live
`apps/lens/scripts/bench.ts`. That fix is in, but **the benchmark still does not
produce a number.** It aborts in `verifyCorpus()` before the first model call:

```
Error: Corpus validation failed for bug-03-mutation-while-iterating: got 1,2, expected [1, 2].
```

Two defects in the corpus, both in Devin's scope (`scripts/`, `fixtures/`), neither fixed:

1. `evaluateBuggySnippet` returns `String(result)`, so an array comes back as `1,2` and is
   compared against the fixture's `[1, 2]`. Mismatched formats — hits every array-valued
   bug (`bug-03`, `bug-11`).
2. Four rows have `expected === actual` (`bug-03`, `bug-11`, `bug-17`, `bug-20`). A bug
   whose expected and actual agree is not a bug, and the validator's first check rejects
   it on exactly that ground.

Until both are fixed and the benchmark runs end to end, **there is no benchmark beat.**
Cut it from the 3 minutes rather than saying a number nobody has seen.

## If something breaks
- Vision call hangs → keep talking. The frame and the last observation are already on
  screen, and the Inspector has the raw JSON. That screen alone is a demo.
- Camera denied → the page tells you exactly how to re-grant it. Do it, restart the
  session. Rehearse this once; it is the single most likely failure.
- Wifi dies → there is no offline mode. Go straight to the backup video and say so
  plainly. Do not claim a local fallback we don't have.
- Anything else → backup video, `demo/backup-video/`. Recorded at H+18, no exceptions.

---

## Cut beats

Removed from the old script because the surface does not exist in `apps/lens`. Verified
against the running app and the source on 2026-09-19.

| Old beat | Why it's gone |
|---|---|
| Editor with buggy Kadane | There is no code editor anywhere in `apps/lens`. |
| Typed predict box + **Run** | Predictions are spoken — the voice agent's `record_prediction` tool writes them to the Predictions list. `ExperimentCard` has the typed version with a run-gated-on-prediction rule, but **nothing imports it**. |
| Gap box (`you said −1 · returned 0 · correct −1`) | No `GapBox` component and no numeric predicted-vs-actual UI. The real "gap" is visual: camera frame vs. reference frame, via `/api/vision/compare`. |
| The shrinker | `shrinkToFailingCase` is real in `lib/sandbox.ts` and exposed at `/api/sandbox/run`, but **no UI calls that route**. Working backend, no front end. |
| "Still stuck" button | No such control. Escalation is automatic, via `useStallWatch` detecting silence after a question. |
| "Five rungs in one call, redacted server-side" | Wrong mechanism. One intervention is generated per call, capped at the next allowed rung. Nothing is generated then hidden — which is a *stronger* claim, so the beat was retold rather than cut. |
| Source card with a verbatim quote | No `SourceCard`. `citation?: { text, source }` exists in `lib/types.ts` and is rendered nowhere. Retrieval really does feed the reasoning call; the quote just never reaches the screen. |
| "Eleven model calls skipped" | No such metric. `lib/metrics.ts` has no skipped-call counter. The strip's real thesis number is **Direct answers given: 0**. |
| Mistake sidebar | Not built. |

**Do not re-add a beat from this table without checking the code first.** Every one of
them reads as plausible and every one of them would die on stage.
