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
| Warp | terminal workflows for every demo command | `infra/warp/lens.yaml` | Backend 1 |
| Voloridge | 20-bug benchmark, plain LLM vs LENS | `apps/lens/scripts/bench.ts`, `apps/lens/fixtures/bugs.json` | Backend 2 |
| Cognition | background agent kept running overnight; PRs reviewed each morning | PR history, `docs/devin-briefs.md` | Fullstack |
| Deepgram | **not wired in `apps/lens`** — decision pending (port think-aloud, or cut the claim) | — | Fullstack |
| Token Company | **not wired in `apps/lens`** — decision pending (token counter, or cut the claim) | — | Frontend |
| Long Lake | — | submission | Frontend |
| Ramp | — | submission | Frontend |

Booth card text and credits: `demo/booth/`.
