# LENS

Every other tutor sees the question. This one sees the attempt.

LENS watches you do a real thing — through the camera, your voice, or your screen — and
catches the mistake while you are still making it. Solder a resistor into the wrong row and
it says so before you reach for the next one. Assemble a gear train, work a problem on paper,
click through a console you have never used: it is the same system, looking at whatever you
are actually doing.

It is built so that it *cannot* hand you the answer. Hints climb five rungs and the locked
ones are redacted on the server, not hidden in the browser — you cannot inspect your way to
the fix. When a claim is backed by your own notes, it is quoted verbatim; when it isn't, no
claim is made.

Code is one thing it can watch. It is not the point.

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
