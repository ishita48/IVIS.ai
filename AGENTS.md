# Working in this repo

LENS is a Next.js app in `apps/lens/`, built in 24 hours at HackMIT 2026. A human is asleep
while you work. Everything below exists so they can review your PR in five minutes at 8am
and merge it without reading the whole diff.

**The demo runs out of `apps/lens/`.** `services/`, `apps/web/`, and `contracts/` are an
earlier architecture that the build overtook — `apps/lens` never calls them, and `apps/web`
has never even been installed. Nothing you write in that tree reaches a judge. Read
[`docs/sponsors.md`](docs/sponsors.md) before anything else: it maps every sponsor to the
file in `apps/lens` that actually runs.

Other agents are editing this repo right now. [`docs/agent-coordination.md`](docs/agent-coordination.md)
says who owns which files and what is already done — read it before your first edit.

## Hard rules

1. **`contracts/` is frozen.** Do not edit a schema, a fixture, or `events.md`. A PR that
   touches `contracts/` gets closed unread. If your task looks like it needs a contract
   change, stop and say so in the PR body instead — that is a useful result.
2. **Stay off the demo path.** `apps/lens/` is the app that gets demoed on stage, so it is
   partly open and partly closed:
   - **Open, when your brief says so:** `apps/lens/lib/`, `apps/lens/scripts/`,
     `apps/lens/app/api/`, and new test files.
   - **Closed, always:** `apps/lens/components/`, `apps/lens/hooks/`, `apps/lens/middleware.ts`,
     and every page under `apps/lens/app/` that is not `api/`. If your change needs a UI
     mount, write the module and say in the PR where a human should mount it. Do not mount it
     yourself.
   - **Closed, always:** `apps/web/`, `demo/script.md`, `demo/booth/`, `demo/backup-video/`.
     `demo/blurbs/` is fine.
   `services/` and `apps/web/` are the earlier architecture and are not on the demo path.
   Do not add features there — nothing you write in that tree reaches a judge.
3. **One task, one branch, one PR.** Branch `devin/<short-slug>`, target `main`. Other agents
   are running in parallel on other files — do not touch files outside your task's scope,
   even to fix something obviously wrong. Note it in the PR body and move on.
4. **Never invent a path, a number, or an integration.** Every file path you write in prose
   must exist in the tree. A judge checks these at the booth.
5. **No new dependencies** unless the task says so. No reformatting, no renaming, no
   drive-by refactors.

## The machine you're on

```bash
cd apps/lens && npm ci          # the shipping app. has a lockfile.
```

Only if your brief sends you into `services/`:

```bash
pip install -r services/proof-engine/requirements.txt -r services/brain/requirements.txt
pip install pytest jsonschema   # not in any requirements file yet
```

Two known potholes, so you don't spend an hour on them:

- `pytest` is not declared anywhere. Install it as above.
- The `test` target in the `Makefile` calls `python`, not `python3`. If `make test` dies with
  "command not found", run the two suites directly and say so in the PR:
  `cd services/proof-engine && python3 -m pytest -q` and the same in `services/brain`.
  Do not "fix" the Makefile unless that is your assigned task.

What is **not** available to you, and will never be:

- **API keys.** `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `DROPBOX_ACCESS_TOKEN`
  are all empty. Anything that calls a model or a third party cannot run here.
- **Elastic.** `docker compose -f infra/elastic/docker-compose.yml` is not up. Assume
  `localhost:9200` refuses the connection.

So: write tests and code that run without network. If verifying your change requires a key
or a live index, you have the wrong task — say so in the PR and stop.

## Verifying

In `apps/lens/`, which is where the real work is:

```bash
npm run typecheck   # tsc --noEmit. This is the bar. It must pass.
npm run lint
```

**There is no test runner in `apps/lens` today** — no vitest, no jest, no test files. Do not
assume one exists. If your brief tells you to add one, that is a deliberate task; otherwise
`typecheck` is your only gate and you should say so honestly in the PR.

In `services/`, the bar is `make test` (pytest). If it was already failing when you started,
say which tests were red on arrival.

**`make bench` is a trap** — it runs the dead tree. The benchmark that counts is
`npx tsx scripts/bench.ts` from `apps/lens`.

## House style

Tests read like the two that already exist — [`services/proof-engine/tests/test_shrink.py`](services/proof-engine/tests/test_shrink.py)
and [`services/brain/tests/test_ladder.py`](services/brain/tests/test_ladder.py). Long
descriptive test names, a one-line docstring saying *why the behaviour matters to the
product*, few assertions. Prose in this repo is short declarative sentences. No adverbs, no
hedging, no bullet lists where a sentence works.

## The PR body

Four lines, no template, no emoji:

- what changed
- how you verified it (paste the `make test` tail)
- what you deliberately did not touch
- anything you found that is wrong but out of scope

## Map

| Where | What |
|---|---|
| `contracts/` | the three frozen shapes — read, never write |
| `services/proof-engine/` | sandbox · differ · shrink · history · cascade |
| `services/brain/` | divergence · ladder · memory · benchmark |
| `services/gateway/` | the only service the browser talks to |
| `services/sources/` | dropbox → pdf → elastic → verbatim quote |
| `apps/web/`, `apps/lens/` | frontend — off limits |
| `demo/blurbs/` | one file per sponsor, yours to fill |
| `docs/` | architecture, handoffs, ownership, timeline, sponsors |
