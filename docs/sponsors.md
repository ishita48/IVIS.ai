# Sponsor map

Where each integration actually lives in the tree — so a booth question gets a file, not a gesture.

| Sponsor | Integration | Lives in | Lane |
|---|---|---|---|
| OpenAI | divergence analysis + hint ladder, embeddings | `services/brain/app/llm/`, `services/brain/app/memory/embeddings.py` | Backend 2 |
| Elastic | mistake memory (kNN) + notes search (hybrid) + live LENS source retrieval | `services/brain/app/memory/elastic.py`, `services/sources/ingest/index_elastic.py`, `apps/lens/lib/elastic.ts` | Backend 2 / Fullstack |
| Dropbox | notes folder → source tier | `services/sources/ingest/dropbox_sync.py` | Fullstack |
| Deepgram | think-aloud, timestamps aligned to edits | `apps/web/src/voice/deepgram.ts` | Fullstack |
| ElevenLabs | voice TA in the browser | `apps/web/src/voice/elevenlabs.ts`, `services/gateway/app/routes/voice.py` | Fullstack |
| Warp | terminal workflows for every demo command | `infra/warp/lens.yaml` | Backend 1 |
| ASUS | GX10 local model, the offline fallback | `services/brain/app/llm/local_gx10.py` | Backend 2 |
| Token Company | the cascade + token counter | `services/proof-engine/app/cascade.py`, `apps/web/src/components/TokenCounter.tsx` | Backend 1 / Frontend |
| Voloridge | 20-bug benchmark, plain LLM vs LENS | `services/brain/bench/` | Backend 2 |
| Cognition | background agent kept running overnight; PRs reviewed each morning | PR history | Fullstack |
| Long Lake | — | submission | Frontend |
| Ramp | — | submission | Frontend |

Booth card text and credits: `demo/booth/`.
