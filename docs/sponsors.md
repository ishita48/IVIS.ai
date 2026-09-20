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
| Deepgram | think-aloud dictation in the workspace chat. Server-side (`nova-3`, `filler_words=true`) because this account's key lacks `keys:write`, so no browser token can be minted — the key never leaves the server. Distinct from the ElevenLabs agent's STT: that transcribes a conversation, this transcribes the student thinking out loud. | `app/api/deepgram/transcribe/route.ts`, `hooks/useDictation.ts`, `components/product/Chat.tsx` | Fullstack |
| Elastic (memory) | mistake memory — beliefs embedded and recalled by kNN across every surface | `lib/mistakes.ts`, `lens-mistakes` index, `components/product/flashcards/MistakeMemory.tsx` | Backend 2 |
| Token Company | the cascade, made visible. A free deterministic RECALL pass gates the two model passes behind it; when it fires, `callsAvoided` counts calls that genuinely did not happen — not an estimate. On the metrics strip as **Model calls avoided**. | `lib/orchestrator.ts` (GATE), `lib/metrics.ts`, `components/product/MetricsStrip.tsx`, `components/product/reasoning/PipelineTrace.tsx` | Backend 2 / Frontend |
| Long Lake | — | submission | Frontend |
| Ramp | — | submission | Frontend |

Booth card text and credits: `demo/booth/`.
