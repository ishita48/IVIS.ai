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
| Warp | LENS Guide — goal-aware walkthrough of an unfamiliar console (Atlas, Vercel, Clerk), driven from the browser extension | `apps/lens/extension/`, `apps/lens/lib/guide.ts`, `apps/lens/lib/guide-state.ts`, `apps/lens/app/api/guide/` | Backend 1 |
| Voloridge | **not wired in `apps/lens`** — the data objective (prompt V1) is unbuilt; the 20-bug benchmark does not qualify | — | Backend 2 |
| Cognition | background agent kept running overnight; PRs reviewed each morning | PR history, `docs/devin-briefs.md` | Fullstack |
| Deepgram | **not wired in `apps/lens`** — decision pending (port think-aloud, or cut the claim) | — | Fullstack |
| Token Company | **not wired in `apps/lens`** — decision pending (token counter, or cut the claim) | — | Frontend |
| Long Lake | — | submission | Frontend |
| Ramp | — | submission | Frontend |

Booth card text and credits: `demo/booth/`.

## Rows that do not yet point at code

`docs/sponsor-criteria.md` wins where it disagrees with this table. Two rows above were
retargeted on 2026-09-20 because the old entries aimed at the wrong rubric:

- **Voloridge — "Signal in the Noise."** Judged on work built with *their* curated public
  datasets. `scripts/bench.ts` is a 20-bug code benchmark with no Voloridge dataset in it,
  so it cannot carry this row. The intended integration is the data objective in prompt V1
  (`docs/round4-prompts.md`): `lib/datasets/`, `fixtures/datasets/`, `app/api/datasets/`,
  new entries in `lib/objectives.ts`. **None of those paths exist in the tree yet** — not on
  `main`, not on `cursor/data-objective`. Until they do, LENS has nothing to submit here and
  the row stays empty rather than pointing at the benchmark.
- **Warp — Best Developer Tool.** Using Warp itself is optional; the prize is for improving
  developer experience. `infra/warp/lens.yaml` is four terminal workflows for running the
  demo, which is not a developer tool, so the row now leads with the Guide extension, which
  is. The second half of the Warp angle — packaging `lib/server-boundary.test.ts` as a CLI at
  `scripts/boundary-check.ts` — is prompt W1 and is **also unbuilt**. The test itself is real
  and green (`apps/lens/lib/server-boundary.test.ts`); only the CLI wrapper is missing.
