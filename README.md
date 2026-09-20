# LENS

A checker decides right and wrong. A model explains why. Never the other way around.

Most AI tutors read your code and tell you the answer. LENS runs your code against a
reference solution on hundreds of generated inputs, shrinks the failure to the smallest
input that still breaks it, and only then wakes a model — to name the *belief* you got
wrong. Hints arrive as five rungs you climb one at a time, and the locked ones are
redacted server-side. Every claim is quoted verbatim from your own lecture notes, or no
claim is made.

## Run it

The demo is the Next.js app in `apps/lens/`. That is the only thing you need to start.

```bash
cd apps/lens && npm install && npm run dev
```

Open http://localhost:3000/app, start the camera, point it at something, tap **Analyze**.

First run on a new machine also needs keys and index setup — see
[`apps/lens/README.md`](apps/lens/README.md) for `.env.local`, `npm run db:setup`,
`npm run search:setup`, and `npm run elastic:setup`.

## Layout

```
apps/lens/          THE DEMO. Next.js app — camera, reasoning, ladder, sources, voice.
  lib/              elastic · dropbox · mongodb · embeddings · vision · reasoning
  hooks/            useAgent (ElevenLabs), useCamera, useStallWatch, usePointer
  app/api/          every route the browser talks to
  scripts/          bench, elastic-check, dropbox-check
  extension/        Guide mode — on-page walkthrough overlay
infra/              elastic compose, warp workflows
demo/               script, booth card, blurbs, backup video
docs/               architecture, handoffs, ownership, timeline, sponsors

contracts/          earlier architecture — frozen JSON shapes, kept for reference
apps/web/           earlier architecture — NOT on the demo path
services/           earlier architecture — NOT on the demo path
```

## Where to start

- Changing a contract → [`contracts/README.md`](contracts/README.md)
- Which sponsor lives where → [`docs/sponsors.md`](docs/sponsors.md)
- Who owns what → [`docs/ownership.md`](docs/ownership.md)
- How the pieces fit → [`apps/lens/ENGINEERING.md`](apps/lens/ENGINEERING.md) (demo path), [`docs/architecture.md`](docs/architecture.md) (earlier design)
- What we cut and when → [`docs/timeline.md`](docs/timeline.md)
