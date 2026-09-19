# LENS

**The tutor that never gives you the answer.**

Every AI tutor sees the question. LENS sees the attempt — your screen, your
physical workspace, what you predicted and what you retried — and
reconstructs the exact point where your reasoning left the material.

Built on the StudyO codebase for HackMIT 2026, Education track.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in the keys marked REQUIRED
npm run db:setup               # collections + indexes
npm run search:setup           # Atlas vector index (one time per cluster)
npm run elastic:setup          # Elastic source index (local or Elastic Cloud)
npm run dev
```

Open http://localhost:3000/app, start the camera, point it at something,
tap **Analyze**.

### Elastic sponsor setup

Run local Elasticsearch with `docker compose -f ../../infra/elastic/docker-compose.yml up -d`
from `apps/lens`, then add `ELASTIC_URL=http://localhost:9200` to
`apps/lens/.env.local` and run `npm run elastic:setup`. New sources are
chunked and indexed in Elastic with BM25 text search plus kNN vector search.
The reasoning engine and `/api/search/vector?mode=elastic` use that hybrid
retrieval automatically; Atlas remains the fallback and system of record.

For Elastic Cloud, set `ELASTIC_URL` to the deployment endpoint and
`ELASTIC_API_KEY` to a restricted API key with index create/write/read access.
Do not commit `.env.local` or paste API keys into chat.

**Read `ENGINEERING.md` before writing code.** It is short and it is the
reason this demo will survive a judge's follow-up question.

---

## What LENS is

Four capabilities, in priority order:

| Capability | What it does | Status |
|---|---|---|
| **LENS Vision** | Camera watches a physical workspace; LENS narrates, points, questions, verifies | **P0** |
| **LENS Pointer** | Points at the exact on-screen element or physical object being discussed | **P0** |
| **LENS Proof** | Runs checkable work for real, finds the smallest failing case | P1 |
| **LENS Sources** | Grounds conceptual answers in the student's own material | Inherited, extend |

### The one rule

> LENS escalates help. It doesn't dump solutions.

```
L1  Point      — draw attention, say nothing about why
L2  Ask        — a question answerable from what's in front of you
L3  Nudge      — one conceptual sentence that reframes
L4  Experiment — the smallest change that tests the belief
L5  Explain    — only after L1–L4 have actually been attempted
```

The ladder is enforced server-side in `lib/reasoning.ts`, not just asked
for in a prompt.

---

## The MVP loop

This is the whole demo. Everything else is additive polish that must never
delay it:

```
camera frame → real vision call → typed observation + bbox
    → reasoning over the real event log → question (not answer)
    → student answers → recorded as an event
    → student acts → NEW frame → LENS compares
    → understanding check → reasoning graph updates
```

Done means: camera permission → live frame → real API call → structured
JSON → rendered overlay, with **no stage replaced by a mock**, and at least
one full escalation demonstrated live.

---

## Architecture

```
Next.js 16 (App Router) · Clerk · MongoDB Atlas + Vector Search
│
├── /api/vision/analyze     OpenAI GPT-4o, enforced json_schema
├── /api/pointer/screen     Claude Computer Use (ported from the macOS app)
├── /api/reasoning/analyze  Gemini/Gemma via lib/llm.ts, over real events
├── /api/events             the log everything else derives from
├── /api/metrics            aggregations, not counters
├── /api/experiments/*      Proof tier (P1)
└── /api/sandbox/run        Piston, real execution (P1)
```

**Three model providers, each for what it is actually best at.** GPT-4o
does scene understanding with Structured Outputs. Claude Computer Use does
pixel coordinates — it has coordinate-specific training that plain vision
APIs don't, which is the entire reason the on-screen pointer is worth
demoing. Gemini handles text reasoning through the existing `lib/llm.ts`
wrapper with its OpenAI fallback already wired.

### Key files

| File | Owner | What |
|---|---|---|
| `lib/lens/contracts.ts` | **everyone** | The hour-0 team contract. Agree on it, then build in parallel. |
| `lib/vision.ts` | Person 2 | Vision + strict JSON schema |
| `lib/reasoning.ts` | Person 2 | Belief reconstruction + ladder enforcement |
| `lib/pointer.ts` | Person 3 | Computer Use port |
| `lib/sandbox.ts` | Person 3 | Piston + failing-case shrinker |
| `lib/events.ts` | Person 4 | The event log |
| `lib/metrics.ts` | Person 4 | Every demo number |
| `components/product/camera/CameraView.tsx` | Person 1 | **The demo** |

### New collections

`events` · `reasoning_states` · `camera_frames` · `experiments`

Camera frames are analyzed on demand and **never stored** — only the
derived observation is persisted. That claim is worth keeping, so don't
add a `storagePath` without changing the UI to say so.

---

## Team ownership

| Person | Owns | Critical deliverable |
|---|---|---|
| 1 — Frontend / Demo | CameraView, overlays, ReasoningGraph, the pitch | Camera tab rendering real bboxes from real responses |
| 2 — Vision & Reasoning | `lib/vision.ts`, `lib/reasoning.ts`, their routes | Frame in → typed observation + question out |
| 3 — Pointer & Proof | `lib/pointer.ts`, `lib/sandbox.ts` | On-screen pointer working against a real PDF |
| 4 — Integrations & Infra | events, metrics, Dropbox, ElevenLabs, deploy | Dropbox folder → embedded sources; voice in camera mode |

## If time disappears, protect in this order

1. Camera capture → real vision call → typed response
2. Bounding box rendered over the video feed
3. One full ask → predict → act → verify cycle
4. Understanding check
5. Reasoning graph (can degrade to a plain list, still real data)
6. Screen-mode Pointer
7. Dropbox ingestion
8. ElevenLabs voice
9. Proof tier / sandbox

---

## What was cut from StudyO, and why

Removed: video generation (+ ffmpeg/Cloudinary), Canvas, concept maps,
quizzes, flashcards, groups/collaboration, library folders, the VARK
onboarding quiz, product tour, Vapi voice agent, analytics dashboards.

None of it was bad code. It was a different product's code. StudyO's loop
is *content in → AI → study tools out*, and it stays in the incubator
doing that. LENS's loop takes a second, orthogonal input — observation of
the actual attempt — and the study-tool surface area was diluting a demo
that has three minutes to land one idea.

Kept and reused: Clerk auth, `lib/llm.ts`, `lib/embeddings.ts` (Atlas
vector search), `lib/extract.ts`, the agent's SSE + `TOOL_CALL` protocol,
the Chrome extension, and the sources pipeline.

## Sponsors

Three, deep, because each maps to a capability the product needs anyway:

- **OpenAI** — GPT-4o vision powers the whole camera loop; Codex used
  during the build (name a specific thing it wrote, not "we used it a lot")
- **Dropbox** — course folder → personalized tutor, which is their own
  stated example use case. Currently a scaffold that returns 501: finish it
  or cut the claim, don't demo the middle state.
- **ElevenLabs** — voice TA during camera mode, where the student's hands
  are literally full

Anthropic Computer Use is free by construction — the Pointer already
requires it.
