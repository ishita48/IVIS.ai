# Hour 0 — what each of you does first

Before anyone writes a route handler, all four read
`lib/lens/contracts.ts` together and agree on it. Those three interfaces
are how you work in parallel without blocking each other.

```ts
VisionObservation   // Person 2 → Person 1
ReasoningState      // Person 2 → Person 1
PointerTarget       // Person 3 → Person 1
```

## Setup (everyone, ~20 min)

```bash
npm install
cp .env.example .env.local
npm run db:setup
npm run dev
```

Exit criteria: `npm run dev` boots and `/app` renders with the camera tab.
No LENS feature works yet — that's expected, the keys and the wiring come
next.

## First task per person

**Person 1 — Frontend / Demo Lead**
`components/product/camera/CameraView.tsx` already captures a frame and
calls the real endpoint. Your first job is making the bbox overlay look
correct against a real `object-contain` video at several window sizes —
the overlay is normalized, the video letterboxes, and that mismatch is the
bug you will otherwise find on stage.

**Person 2 — Vision & Reasoning**
`lib/vision.ts` and `lib/reasoning.ts` are written and typed. Your first
job is prompt iteration against real frames of the actual object you will
demo. Take twenty photos of the real circuit and tune `VISION_SYSTEM`
until the observations are specific and the questions never leak the
answer. This is the highest-leverage work in the whole hackathon.

**Person 3 — Pointer & Proof**
`lib/pointer.ts` + `hooks/usePointer.ts` are a faithful port. Your first
job is verifying coordinate accuracy end to end: capture, call, render,
measure the error in pixels. If it is off by a consistent factor of two,
read the Retina note in `hooks/usePointer.ts` — that is the bug.

**Person 4 — Integrations & Infra**
Events and metrics are wired. Your first job is deploying to Vercel with
real env vars so the team is not discovering deploy problems at hour 40.
Then Dropbox OAuth (the route currently 501s on purpose).

## Hour 3 checkpoint

One person demos: camera on → Analyze → a real observation appears in the
right panel. Unstyled is fine. If that is not working at hour 3, stop
adding and debug — nothing downstream matters without it.

## The sentence to repeat to judges

> "Every AI tutor gives you the answer. LENS never does. It watches you
> work, points at the thing that matters, and asks what you think before
> it tells you anything."

And when the metrics strip reads **direct answers: 0** — say that number
is a query over the event log, not a constant. That is the part that makes
it credible.
