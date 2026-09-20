# LENS — submission paragraphs

One paragraph per challenge, written against that challenge's own rubric
rather than as a general pitch. Every paragraph names a file path, and
every number in here was measured, not estimated.

Deepgram now qualifies: `apps/lens/lib/deepgram.ts` powers the "Think aloud"
control in `apps/lens/components/Camera/CameraView.tsx` (PR #25), streaming
mic audio to Deepgram and stamping each utterance with the vision or
reasoning call in flight — verified live, 5 of 22 utterances stamped against
a real MongoDB row. `apps/lens/hooks/useDictation.ts` is the second call
site, mounted in `components/product/Chat.tsx` for push-to-talk
transcription through `/api/deepgram/transcribe`.

---

## Long Lake — the skeptic

The skeptic thinks AI means a chatbot that answers things. Hand them the
printed gear train and ask what the output gear does per crank turn.
They say "three turns" — everyone does, because two 3:1 stages feel like
they add. LENS does not correct them. It asks how many places on the
train teeth actually mesh, and then waits. They crank it, count nine, and
the reason arrives in their own head rather than from a speaker. The
ladder that holds that line is `apps/lens/lib/objectives.ts`, and the
server-side cap in `lib/reasoning.ts` is what stops the model skipping to
the answer under pressure. They come back because it never once told them.

## Ramp — time and money

A lab or a classroom pays for attention: one TA per bench, most of it
spent waiting for someone to get stuck. LENS watches instead, and only
costs something when the scene changes. `apps/lens/lib/frame-cascade.ts`
refuses a vision call when the frame hash is identical, when the motion
watcher saw nothing move, or when the last call was under four seconds
ago — so an idle bench is free. The model wakes for the moment a student
is actually stuck, which is the only moment worth paying a human for
either. The savings are counted live in the metrics strip rather than
asserted.

## Dropbox — class materials into a personalized tutor

That is their own example, and it is the literal data path.
`apps/lens/lib/dropbox.ts` lists and downloads a student's notes folder;
`lib/embeddings.ts` chunks and embeds each file with
`text-embedding-3-small` at 1536 dimensions; and the reasoning call
retrieves from that index before it says anything, so a hint is grounded
in the student's own lecture rather than in the model's general knowledge.
When nothing in their material supports a claim, the engine returns
`not_in_notes` and stays quiet instead of inventing a citation. The
tutor is personalized because the source of truth is the folder they
already keep, not a corpus we chose for them.

## Elastic — find the signal

The signal is a misconception recurring across sessions in words that do
not match. A student who says "the stages add up" in March and "it's
three to one twice" in April is making one mistake, and string matching
will never see it. `apps/lens/lib/mistakes.ts` embeds each recorded
mistake and runs kNN against the stored ones, so the second occurrence
finds the first and increments a count rather than opening a new row.
That count is the thing worth surfacing to a teacher: not what one
student got wrong once, but what a room keeps getting wrong. Notes
retrieval in `lib/elastic.ts` runs the same hybrid index.

## The Token Company — the gate before the model

The creative part is refusing to call the model at all.
`apps/lens/lib/frame-cascade.ts` gates every vision call three ways: an
identical frame hash, an unchanged scene from the motion watcher, or a
call inside the four-second window returns the prior observation and
spends nothing. The second trick is cheaper still — `lib/vision.ts`
threads the *previous observation as text* into the next prompt instead
of a second image, so continuity costs about a kilobyte rather than
another vision payload. `lib/llm.ts` then runs Gemma first and falls back
to `gpt-4o-mini`. Skipped calls and tokens spent are both rendered live
in the metrics strip.

## Cognition — honest denominators

Devin opened 17 pull requests against this repository. Thirteen merged,
four were closed for scope, none are open. It found four real defects we had
not, including the broken `analyze` import recorded against PR #8 in
`docs/devin-log.md`. It also introduced one — it pulled the
Mongo driver into a client bundle. That was found after merge, not before:
the guard, `lib/server-boundary.test.ts`, was written the same night and
is now a standalone CLI at `apps/lens/scripts/boundary-check.ts`. That
ratio is the honest report: useful at breadth, and it needed a guard rail
that a human wrote to stay inside the lines.

## OpenAI — schema-enforced, not parsed out of prose

`apps/lens/lib/vision.ts` calls GPT-4o with Structured Outputs and
`strict: true`, so `observation`, `boundingBox`, `confidence` and
`shouldRevealAnswer` come back as a validated object — the box that is
drawn on the student's video is never regexed out of a paragraph.
`lib/embeddings.ts` uses `text-embedding-3-small` at 1536 dimensions for
every source the student uploads, and `lib/llm.ts` keeps `gpt-4o-mini` as
the reasoning fallback so the hint ladder never goes dark when the
primary provider fails. Codex closed a gap of its own in
[PR #20](https://github.com/raoisha1/IVIS.ai/pull/20): the metrics
backend had been returning skipped calls and tokens spent for days while
the strip rendered neither.

## Voloridge — the misconception a dataset exposes

**The air at O'Hare is hottest at 16:00, not at noon, and the wind is
strongest in the late afternoon rather than at night.** Both are the same
misconception: people expect air to answer the sun instantly. LENS makes
a student commit to an hour before any query runs, then runs it against a
committed NOAA ISD slice — 8,757 hourly rows from station 725300-94846 —
and the ladder in `apps/lens/lib/datasets/noaa-isd.ts` names the belief
without stating the fix. Noon averages 26.5 °C against 27.9 °C at 16:00,
and afternoons are 2.0× windier than the hours before dawn. The dataset
is the noise; the student is looking for the signal.

## SpaceXAI — detection bias, drawn by Grok

**85.6% of confirmed exoplanets are smaller than Jupiter, and every one
of the 560 hot Jupiters with a measured orbit sits inside Mercury's.**
Both predictions go the other way for the same reason: transit and
radial-velocity surveys found 4,708 and 1,200 of these planets
respectively, and both see big close-in worlds most easily — so the
famous planets are the easy ones, not the common ones. The objective
lives in `apps/lens/lib/datasets/nasa-exoplanets.ts` over the NASA
Exoplanet Archive's confirmed-planets table, and `lib/grok.ts` calls Grok
Imagine to draw the reference chart the student compares their mental
picture against.

## Warp — a developer tool first, a tutor second

`npm run boundary` runs `apps/lens/scripts/boundary-check.ts`: it starts
at every `"use client"` file, walks value imports, and exits 1 with the
offending chain when the walk reaches the Mongo driver or a server
secret. It was written because that had already happened — a client hook
reached `lib/pointer.ts → lib/token-ledger.ts → lib/events.ts → mongodb`
and Next crashed on `child_process`. It is a CLI any Next.js App Router
repo can run, not something specific to us. Second, the LENS Guide
extension in `apps/lens/extension/` and `app/api/guide/step` walks a
developer through an unfamiliar console one step at a time.
