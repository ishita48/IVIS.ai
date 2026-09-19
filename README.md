# LENS

A checker decides right and wrong. A model explains why. Never the other way around.

Most AI tutors read your code and tell you the answer. LENS runs your code against a
reference solution on hundreds of generated inputs, shrinks the failure to the smallest
input that still breaks it, and only then wakes a model — to name the *belief* you got
wrong. Hints arrive as five rungs you climb one at a time, and the locked ones are
redacted server-side. Every claim is quoted verbatim from your own lecture notes, or no
claim is made.

## Run it

```bash
cp .env.example .env     # fill in keys
make up                  # elastic
make proof               # :8001   pane 2
make brain               # :8002   pane 3
make gateway             # :8000   pane 4
make sources             # :8003   pane 5
make web                 # :5173   pane 6
```

Frontend alone, no backend, no keys:

```bash
make mock
```

## Layout

```
contracts/          the three frozen JSON shapes + fixtures. read this first.
apps/web/           editor, ladder, gap box, source card, token counter, mic
services/
  proof-engine/     sandbox · differ · shrink · history · cascade
  brain/            divergence · ladder · openai/gx10 · mistake memory · benchmark
  gateway/          the only service the browser talks to; fans in one SSE stream
  sources/          dropbox → pdf → elastic → verbatim quote
infra/              elastic compose, warp workflows
demo/               script, booth card, 12 blurbs, backup video
docs/               architecture, handoffs, ownership, timeline, sponsors
```

## Where to start

- Changing a contract → [`contracts/README.md`](contracts/README.md)
- Who owns what → [`docs/ownership.md`](docs/ownership.md)
- How the pieces fit → [`docs/architecture.md`](docs/architecture.md)
- What we cut and when → [`docs/timeline.md`](docs/timeline.md)
