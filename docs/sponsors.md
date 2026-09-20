# Sponsor map

Where each integration actually lives in the tree — so a booth question gets a file, not a gesture.

The demo runs out of `apps/lens/`. Paths below point at code that runs in that app. Anything
under `services/` or `apps/web/` is the earlier architecture and is **not** on the demo path.

| Sponsor | Integration | Lives in | Lane |
|---|---|---|---|
| OpenAI | embeddings for source retrieval + vision on the camera frame | `apps/lens/lib/embeddings.ts`, `apps/lens/lib/vision.ts`, `apps/lens/app/api/vision/` | Backend 2 |
| Elastic | source index + hybrid retrieval behind every quoted claim | `apps/lens/lib/elastic.ts`, `apps/lens/lib/setup-elastic.ts`, `apps/lens/scripts/elastic-check.ts` | Fullstack |
| Dropbox | notes folder → source tier, picked inside the Add source dialog | `apps/lens/lib/dropbox.ts`, `apps/lens/app/api/dropbox/` | Fullstack |
| MongoDB | sessions, events, and understanding state | `apps/lens/lib/mongodb.ts`, `apps/lens/lib/db-setup.ts` | Fullstack |
| ElevenLabs | voice TA in the browser | `apps/lens/hooks/useAgent.ts`, `apps/lens/app/api/elevenlabs/signed-url/` | Fullstack |
| Warp | `npm run boundary` — the server-boundary CLI that walks value imports from every `"use client"` file and fails on the Mongo driver or a server secret (PR #21); plus LENS Guide, the goal-aware console walkthrough driven from the browser extension | `apps/lens/scripts/boundary-check.ts`, `apps/lens/lib/server-boundary.test.ts`, `infra/warp/lens.yaml`, `apps/lens/extension/`, `apps/lens/lib/guide.ts`, `apps/lens/app/api/guide/` | Backend 1 |
| Voloridge | data objective over NOAA ISD hourly weather — predict, run the query, ladder names the belief. Built in [PR #22](https://github.com/raoisha1/IVIS.ai/pull/22) (`claude/data-objective-noaa`), **not yet on `main`** | `apps/lens/lib/datasets/`, `apps/lens/fixtures/datasets/noaa-isd.csv`, `apps/lens/app/api/datasets/` — on the PR branch only | Backend 2 |
| Cognition | background agent kept running overnight; PRs reviewed each morning | PR history, `docs/devin-briefs.md` | Fullstack |
| Deepgram | think-aloud dictation in the workspace chat. Server-side (`nova-3`, `filler_words=true`) because this account's key lacks `keys:write`, so no browser token can be minted — the key never leaves the server. Distinct from the ElevenLabs agent's STT: that transcribes a conversation, this transcribes the student thinking out loud. | `app/api/deepgram/transcribe/route.ts`, `hooks/useDictation.ts`, `components/product/Chat.tsx` | Fullstack |
| Deepgram (alt) | `lib/deepgram.ts` + `GET /api/deepgram` mint a browser token via `/v1/auth/grant`. That endpoint returns 403 on this account's key (needs `keys:write`), so it is unreachable until the key is upgraded; the server-side route above is what runs. | `apps/lens/lib/deepgram.ts`, `apps/lens/app/api/deepgram/route.ts` | Fullstack |
| Elastic (memory) | mistake memory — beliefs embedded and recalled by kNN across every surface | `lib/mistakes.ts`, `lens-mistakes` index, `components/product/flashcards/MistakeMemory.tsx` | Backend 2 |
| Token Company | token ledger — every model call and every skipped call is an event; the frame cascade skips unchanged frames and throttles repeats, and the metrics strip shows **Model calls skipped** and **Tokens spent** (PRs #12, #15, #20) | `apps/lens/lib/token-ledger.ts`, `apps/lens/lib/frame-cascade.ts`, `apps/lens/lib/metrics.ts`, `apps/lens/components/product/MetricsStrip.tsx` | Frontend |
| Long Lake | — | submission | Frontend |
| Ramp | — | submission | Frontend |

Booth card text and credits: `demo/booth/`.

## Rows with a caveat

`docs/sponsor-criteria.md` wins where it disagrees with this table.

- **Voloridge — "Signal in the Noise."** Judged on work built with *their* curated public
  datasets. `scripts/bench.ts` is a 20-bug code benchmark with no Voloridge dataset in it,
  so it cannot carry this row. The data objective from prompt V1 is built on
  `claude/data-objective-noaa` (PR #22): `lib/datasets/`, `fixtures/datasets/noaa-isd.csv`,
  `app/api/datasets/`, with `lib/datasets/datasets.test.ts`. Until that PR merges, none of
  those paths exist on `main`; do not claim them at the booth before checking the branch.
- **Warp — Best Developer Tool.** Using Warp itself is optional; the prize is for improving
  developer experience. Two things in the tree are: `npm run boundary`
  (`scripts/boundary-check.ts`, PR #21), which packages `lib/server-boundary.test.ts` as a
  CLI any Next.js repo can run and would have caught PR #12; and the Guide extension.
  `infra/warp/lens.yaml` now carries dev, db setup, elastic up, boundary, test and demo
  token workflows.
- **Deepgram.** `lib/deepgram.ts` and `app/api/deepgram/route.ts` are real but unreferenced.
  The challenge requires a Deepgram API call from the product, so the row does not qualify
  until a hook or component calls the route.
