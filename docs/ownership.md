# Ownership

Four lanes. Each lane owns its column end to end — nobody waits for a review to merge.

| Lane | Owns | Builds | Sponsor entries |
|---|---|---|---|
| **Frontend** | everything the judge sees | Editor + run panel · hint ladder panel · predict-then-run gap box · source card with quote · token counter · mistake sidebar · demo script · backup video · 12 blurbs | Long Lake, Ramp. Booth runs: Warp + Voloridge card text, credits |
| **Backend 1 — proof engine** | right vs wrong | sandbox run · student code vs reference on generated inputs · shrink to smallest failing input · edit + run history · cascade (model wakes only on a failed check) · Warp terminal runs | Token Company, Warp |
| **Backend 2 — brain + data** | hints + evidence | OpenAI call: failing input + history → where reasoning broke → ladder rung JSON · CodeNet → bug patterns → 20-bug benchmark (plain LLM vs LENS) · mistake embeddings → Elastic memory · GX10 local model last | OpenAI, Voloridge, Elastic (memory), ASUS |
| **Fullstack — source tier + voice + glue** | everything crossing front/back | Dropbox folder → parse PDFs → Elastic index → answer vs notes with source sentence, wired into the source card · Deepgram think-aloud timestamps aligned to edits · ElevenLabs voice TA in browser · API server + JSON contract · runs the background agent all night, keeps PRs | Dropbox, Elastic (search), Deepgram, ElevenLabs, Cognition |

## Directory → lane

```
apps/web/                 Frontend
services/proof-engine/    Backend 1
services/brain/           Backend 2
services/gateway/         Fullstack
services/sources/         Fullstack
apps/web/src/voice/       Fullstack  (frontend mounts the button only)
contracts/                shared — changes announced, fixtures updated same commit
demo/                     Frontend
infra/                    Backend 1 (warp) · Backend 2 (elastic)
```

## Standing rules
- **Fullstack is the swing.** Core loop not working by midnight → drop voice, join Backend 1.
- **Audio lives in the browser**, owned end to end by Fullstack. Frontend adds the mic button and the transcript strip, nothing else.
- **The frontend never blocks on a backend.** `make mock` replays fixtures; that path stays working all weekend.
