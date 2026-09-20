# MVP test scripts — the five things that make LENS different

Written 2026-09-20 against main plus the no-repeat ladder fix (uncommitted in the working tree).
Everything else in the repo is out of scope for this pass. Five features, five scripts, five
Claude Code prompts. Run the prompts in five separate Claude Code sessions at once; each one
works on its own branch so they cannot collide.

## What LENS actually claims over the market

Every AI tutor on the market sees the question. LENS sees the attempt. That is the whole pitch,
and each of the five features is one way of making it real:

| # | Feature | The claim a judge can verify on stage |
|---|---|---|
| 1 | Camera (video) | One frame, one real vision call, a box on the one thing that matters, a question instead of the answer. Frames are never stored. |
| 2 | Pointer | Ask about your screen and it points with a real Claude Computer Use call. It shows where to look, never what to type. |
| 3 | Guide extension | On a real console it rings the next control and asks why that step matters before you click. |
| 4 | Concept map | Built only from what the student said, every node backed by a quote checked to be literally in their words. No decorative links. |
| 5 | Understanding | The five-rung ladder is enforced server-side from the event log. The summary curve is only drawn from evidence. |

Two things the marketing language implies that the code does not do. Say them right so the demo
does not promise them:

- **There is no "click a thing and it explains it."** Pointer takes a typed or spoken question
  and points. The Guide extension takes a goal and rings the next control. Neither reacts to a
  click on an arbitrary element, and by design neither explains: they point and ask.
- **The understanding curve only fills if the voice agent calls `note_understanding`.** That is a
  client tool the ElevenLabs dashboard has to have registered. The dashboard table in
  `apps/lens/ELEVENLABS_AGENT.md` still lists it as not added. Until it is, every session
  summary reads "Not enough evidence", which is exactly what the 04:40 screenshot shows.

## Before any script

- Dev server on port 3000 and signed in at `http://localhost:3000/app`. There is no sign-in beat.
- `apps/lens/.env.local`: `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are real. `GOOGLE_API_KEY`
  is still the literal `...`, so every ladder call tries Gemini, fails, then falls back to
  gpt-4o-mini. It works but it is slow. Either paste a real key or blank the line.
- ElevenLabs dashboard: re-paste the system prompt from `ELEVENLABS_AGENT.md` (it now has the
  "Never repeat yourself" section) and make sure all eight client tools in its table exist,
  especially `note_understanding` and `set_mode`.
- Chrome, not Safari, for Pointer and the extension. `getDisplayMedia` and `chrome.tabs` need it.

---

## 1. Camera

**What it is.** The Camera tab of the workspace. `components/Camera/CameraView.tsx` captures one
frame, `POST /api/vision/analyze` runs GPT-4o with Structured Outputs (`lib/vision.ts`), and
`POST /api/reasoning/analyze` computes the rung (`lib/reasoning.ts`, `lib/ladder.ts`).

**Script.**

1. Camera tab. Put a physical object with a visible mistake in frame.
2. Press **Look**. Expected within ~3 s: a box on the object, a **Last look** card with an
   observation, a confidence, and a latency in milliseconds. Console log line reads
   `observed … conf=… box=…`.
3. Press **Look** again without moving anything. Expected: the metrics strip's skipped-call
   count goes up by one and no new vision latency appears. That is the frame cascade.
4. Move the object. Press **Look**. Expected: the card says **changed since last look**.
5. Press **Start Session**. Expected: greeting within ~2 s, exactly once.
6. Say "how many fingers am I holding up?" while holding up four. Expected: it looks (the
   "looking" chip appears with no button press), answers in one sentence, and does not
   announce "let me take a look" first. The transcript shows one LENS turn, not two.
7. Say "I don't know" twice in a row to whatever it asks next. Expected: two different
   sentences, each one rung higher. It never repeats a question in any wording.
8. Cover the lens and ask again. Expected: confidence under 0.3, amber box reading "hard to
   read", and it asks you to reposition instead of describing a frame it could not see.
9. Press **End Session**. Expected: the summary shows a curve if `note_understanding` is
   registered in the dashboard, otherwise "Not enough evidence".

**Broken if:** two LENS turns per look, the same question twice, a greeting twice, or the
box drawn on the wrong object while the logged coordinates point to the right one.

---

## 2. Pointer

**What it is.** The Pointer tab. `components/product/camera/PointerView.tsx` takes a question,
`hooks/usePointer.ts` grabs one frame of a shared screen, `POST /api/pointer/screen` runs
Claude Computer Use with the `computer` tool declared (`lib/pointer.ts`), and a bubble is
drawn at the returned coordinates on the captured frame.

**Script.**

1. Open a second window with something to point at: a terminal with a failing test, a code
   file with an obvious bug, a spreadsheet with one wrong cell.
2. Pointer tab. Type "which line is failing?" and press Enter.
3. Chrome's share sheet appears. Choose the second window. Expected: a **sharing** chip with
   a stop button stays visible afterwards. The share is held open across the session by
   design, so no second prompt on the next question.
4. Expected within ~5 s: the captured frame appears with a pulsing bubble on the failing
   line and a label. The bubble lands on the right thing. If it lands in the wrong quadrant,
   the declared resolution and the image size disagree, which is the Retina trap documented
   at the top of `hooks/usePointer.ts`.
5. Ask a second question. Expected: no share sheet, new bubble.
6. Press **Talk to LENS**, say "where should I be looking?". Expected: the agent calls
   `analyze_workspace`, which in this tab means a Computer Use call, and speaks about what
   Claude saw. It points; it does not read the line's fix aloud.
7. Resize the window between wide and narrow. Expected: bubble stays on the line.

**Broken if:** the share sheet reappears every question, the bubble is at half scale, or the
agent says it cannot see the screen.

---

## 3. Guide extension

**What it is.** `apps/lens/extension/` (Manifest V3). Set a goal in the popup, then each turn
`background.js` screenshots the visible tab, posts it to `POST /api/guide/step`, and
`content.js` draws a ring on the next control plus a card whose "why" is always a question
(`sanitizeWhy` in `lib/guide.ts` strips any statement).

**Script.**

1. `chrome://extensions`, Developer mode on, **Load unpacked**, pick `apps/lens/extension/`.
2. Extension popup, **Settings**, API URL `http://localhost:3000`. Without this it targets the
   deployed app and fails auth.
3. Be signed in to LENS in the same Chrome profile.
4. Open a real console: the AWS console, GitHub repo settings, or Stripe. Something with
   more than one screen between you and the goal.
5. Popup: goal "add a repository secret named DEMO_KEY" (or an EC2 or Stripe equivalent).
   Press **Start guiding**. Switch to the console tab.
6. Expected within ~5 s: a pulsing ring on exactly one control and a card with the step as
   an instruction and a why that ends in a question mark.
7. Click the ringed control. Expected: the overlay disappears before the next capture, then a
   new ring on the next control. One step in flight at a time, even if you click twice.
8. Reach the goal. Expected: the guide says it is done and stops on its own.
9. Back in LENS, Camera tab, start a voice session and ask "what do I do next?". Expected:
   the agent calls `read_guide_step` and reads the current step back.

**Broken if:** the ring is offset from the control (downscale mismatch in
`GUIDE_RESOLUTIONS`), the card's why is a statement, or the popup shows a 401.

---

## 4. Concept map

**What it is.** The Reasoning tab renders `components/product/reasoning/ConceptMap.tsx`.
`lib/conceptmap.ts` builds it from student voice turns and typed chat of at least 12
characters, grounded in active notes, and drops any node or edge whose quote is not
literally inside the turn it cites. `POST /api/concept-map` runs an update.

**Script.**

1. Add one source in the Sources tab: a lecture PDF or a pasted page on a topic you can talk
   about (gear trains, LED polarity, anything with three or four named concepts).
2. Camera tab, Start Session. Talk for two minutes about the topic in your own words. Say at
   least one wrong thing confidently and one right thing.
3. Reasoning tab. Expected: circles for the concepts you named, lines between the ones you
   related, colours by status: grey mentioned, amber shaky, green solid.
4. Click a circle. Expected: the evidence panel shows a quote that is word for word something
   you said, with the turn it came from. Click a line. Expected: the same for the relation.
5. Find the wrong thing you said. Expected: its concept is amber, and the evidence is your
   sentence.
6. Type a new sentence in Chat naming a concept you have not said yet. Expected: after the
   next update the map has one more circle, and nothing else moved.
7. Sanity check in the store: no node exists without evidence. If the map has a circle you
   cannot click through to a quote, the verifier in `lib/conceptmap.ts` has a hole.

**Broken if:** the map is empty after two minutes of talking, quotes are paraphrased, or the
map redraws from scratch each update instead of growing.

---

## 5. Understanding: the ladder and the curve

**What it is.** Two artifacts, both computed from the event log and nothing else.
`lib/ladder.ts` counts genuine attempts (prediction, retry, answered check, and a spoken reply
to a tutor question) and `nextAllowedLevel` caps the rung; `lib/reasoning.ts` clamps the model
to it. `components/Camera/SessionSummary.tsx` draws the curve from `note_understanding` calls.

**Script.**

1. Camera tab, gear train or any object from `lib/objectives.ts` in frame. Start Session.
2. Say "I think the output turns three times per crank." Expected: `record_prediction` is
   called (the Predictions list gains a line) and the next LENS turn points, it does not
   correct.
3. Say "I don't know." Expected: one rung up, a new sentence, no repeat.
4. Say "it goes nine times, same way." Expected: it acknowledges progress without saying
   "correct" and may step back down a rung.
5. The debug panel's `ladder →` log lines should read POINT, ASK, NUDGE in that order across
   the three turns. The text for a rung you have not reached is never generated, which is the
   demo's 2:25 beat.
6. End Session. Expected: a curve with three or more points, first low, last higher, and the
   "To revise" list naming the three-to-one belief. If it reads "Not enough evidence", the
   agent never called `note_understanding`: register the tool in the dashboard and re-run.

**Broken if:** the same question twice, a rung skipped, or an empty summary after a session
where the agent clearly formed a read of you.

---

## Claude Code prompts, one per session

Paste each into its own Claude Code session in `/Users/isharao/IVIS.ai`. Each starts from main
on its own branch and must not touch the others' files. Merge in numbered order.

### Prompt 1: camera

```text
Branch off main as fix/camera-demo. Scope: the Camera tab only (apps/lens/components/Camera/*, apps/lens/lib/vision.ts, apps/lens/lib/frame-cascade.ts, apps/lens/app/api/vision/*). Do not touch lib/reasoning.ts, lib/ladder.ts or ELEVENLABS_AGENT.md; another session owns those.

Run the Camera script in docs/mvp-test-scripts.md section 1, steps 1 to 4 and 8, against the dev server on port 3000 using the built-in browser (I will sign in when you reach the Clerk page; stop and tell me). For each step record pass or fail with the exact console line or screenshot that proves it. Then fix every failure, smallest change first, and re-run the failed step. Typecheck, vitest and npm run boundary must stay green. Report as a table of steps with pass/fail before and after, and the diff summary. Do not commit.
```

### Prompt 2: pointer

```text
Branch off main as fix/pointer-demo. Scope: apps/lens/components/product/camera/PointerView.tsx, PointerOverlay.tsx, apps/lens/hooks/usePointer.ts, apps/lens/lib/pointer.ts, apps/lens/lib/pointer-resolutions.ts, apps/lens/app/api/pointer/screen/route.ts.

Read the Retina and aspect-ratio rules at the top of usePointer.ts and pointer.ts first; they are the accuracy of the feature. Then run docs/mvp-test-scripts.md section 2. Screen share needs a real Chrome window, so use Claude in Chrome for the share step and ask me to pick the window. Verify the bubble lands on the right element at two window sizes and that the share prompt appears once per session, not once per question. If the bubble is offset, check that the JPEG pixel size equals the declared resolution before changing anything else. Fix, re-test, keep typecheck and tests green. Do not commit.
```

### Prompt 3: guide extension

```text
Branch off main as fix/guide-extension. Scope: apps/lens/extension/* and apps/lens/app/api/guide/*, apps/lens/lib/guide.ts, apps/lens/lib/guide-state.ts.

Load the unpacked extension in Chrome (apps/lens/extension), set the popup API URL to http://localhost:3000, and run docs/mvp-test-scripts.md section 3 on the GitHub repository settings page of any repo I own, goal "add a repository secret named DEMO_KEY". Use Claude in Chrome so the extension runs in my signed-in profile. Check three things specifically: the ring sits on the control (compare GUIDE_RESOLUTIONS in background.js to SUPPORTED_RESOLUTIONS in lib/pointer-resolutions.ts), the why on every card is a question, and only one /api/guide/step request is in flight at a time even under rapid clicks. Fix what fails. Also update the tool table in ELEVENLABS_AGENT.md section 4 only for the read_guide_step row if it is wrong; leave the rest of that file alone. Do not commit.
```

### Prompt 4: concept map

```text
Branch off main as fix/concept-map. Scope: apps/lens/lib/conceptmap.ts, apps/lens/app/api/concept-map/route.ts, apps/lens/components/product/reasoning/ConceptMap.tsx, conceptLayout.ts, and the scheduleConceptMapUpdate path in apps/lens/lib/store.ts.

First write a vitest for the verifier in lib/conceptmap.ts: a proposed node whose quote is not literally in the cited turn must be dropped, a valid one kept, and an update must add to the existing map rather than replace it. Mock the model and the database. Then run docs/mvp-test-scripts.md section 4 against the dev server, using typed Chat messages instead of voice so it is reproducible, and confirm every circle and line clicks through to a word-for-word quote. If the map stays empty, trace the path store.scheduleConceptMapUpdate to POST /api/concept-map to updateConceptMap and report where it stops. Fix, keep tests green. Do not commit.
```

### Prompt 5: understanding

```text
Branch off main as fix/understanding-demo. Scope: apps/lens/lib/ladder.ts, apps/lens/lib/reasoning.ts, apps/lens/lib/objectives.ts, apps/lens/components/Camera/SessionSummary.tsx, apps/lens/components/product/reasoning/ReasoningGraph.tsx, apps/lens/hooks/useAgent.ts, apps/lens/ELEVENLABS_AGENT.md.

Read lib/ladder.ts and its test first: a spoken reply to a tutor question now counts as an attempt. Then add a test for lib/reasoning.ts's merge branch proving that once the student has spoken since the latest card, a new intervention at the same rung replaces the old one, and that an identical question is never handed back twice; mock the model, the database and retrieval. Next, reconcile ELEVENLABS_AGENT.md section 4's tool table with hooks/useAgent.ts: every tool the hook implements must have a documented entry with description, wait-for-response setting and parameters, especially note_understanding, set_mode, compare_to_reference and read_guide_step, because the summary curve is empty until note_understanding is registered in the dashboard. Finally run docs/mvp-test-scripts.md section 5 with me on voice and report the ladder log lines and the summary. Do not commit.
```

## After the five sessions

Merge in order 1 to 5, run `npm run typecheck && npm test && npm run boundary` in `apps/lens`,
then rehearse `demo/script.md` twice. The second rehearsal is where you find the dead wifi problem.
