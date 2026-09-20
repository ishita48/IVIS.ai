# Demo script — 3 minutes

Rehearse twice. The second rehearsal is where you find the dead wifi problem.

## 0:00 — the setup (20s)
> "This is a student writing max-subarray. The code is wrong. Every tutor built on an LLM
> would now read the code and tell them the answer. Watch what this does instead."

Editor already has the buggy Kadane on screen. **Do not type it live.**

## 0:20 — predict-then-run (25s)
Type `-1` into the predict box. Hit Run.

> "They predicted the right answer. Their code returns 0. They know the algorithm —
> they mis-encoded it. That is a different lesson, and a plain tutor can't tell the difference."

Gap box shows: you said −1 · it returned 0 · correct is −1.

## 0:45 — the shrinker (25s)
Point at the failing input line.

> "It found this by running their code against a reference on two hundred inputs, then
> shrinking the failure down. It started at eight elements. It's showing three. That's the
> smallest input that still breaks — the whole bug, nothing else."

## 1:10 — the ladder (40s)
Rung 0 is showing. Read it aloud. Click **Still stuck**.

> "Five rungs. It never starts at the answer. And the locked rungs aren't hidden in the
> browser — the server won't send the text until you've climbed to them. You can't inspect
> your way to the fix."

Click once more to rung 2. Stop there. **Do not reach rung 4 on stage.**

## 1:50 — the source card (25s)
> "And the claim isn't ours. That's a sentence from their own lecture notes, in their Dropbox,
> quoted exactly. If we can't find a real sentence that backs the hint, no card appears.
> We don't generate citations."

## 2:15 — the counter (25s)
Point at the header.

> "Eleven model calls skipped. The checker decides right and wrong — it's cheap and it's never
> wrong about *whether*. The model only ever wakes up after a real failing case exists.
> That's not a cost optimization, it's why the hint is always about something real."

## 2:40 — the benchmark (20s)
> "Twenty real bugs mined from CodeNet — actual student submissions, the failed one and the
> one that passed. Against a plain LLM tutor: [number] on locating the line, and zero leaked
> fixes on the first rung versus [number]."

## Close
> "The checker decides. The model explains. Never the other way around."

---

## If something breaks
- Hint hangs → keep talking, the failing input and expected/actual are already on screen. That screen alone is a demo.
- Wifi dies → there is no offline mode. Go straight to the backup video and say so plainly. Do not claim a local fallback we don't have.
- Anything else → backup video, `demo/backup-video/`. Recorded at H+18, no exceptions.
