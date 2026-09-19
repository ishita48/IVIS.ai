# Wire events

One SSE stream per session: `GET /v1/sessions/{session_id}/stream`.
Everything the frontend renders arrives as one of these. No polling.

| event | payload | emitted by | when |
|---|---|---|---|
| `run.started` | `{run_id, problem_id}` | proof-engine | run accepted |
| `run.result` | `RunResult` | proof-engine | sandbox finished (pass or fail) |
| `hint.pending` | `{run_id}` | gateway | cascade decided to wake the model |
| `hint.ready` | `HintResponse` | brain | model returned |
| `hint.unlocked` | `{run_id, rung, text, reveals}` | gateway | student climbed a rung |
| `source.ready` | `SourceCard` | sources | retrieval finished (may trail `hint.ready`) |
| `transcript.partial` | `{ts, text}` | web (Deepgram) | interim think-aloud |
| `transcript.final` | `{ts, text, aligned_edit_id}` | web (Deepgram) | utterance closed + aligned to an edit |
| `tokens.tick` | `{saved, used_total}` | gateway | after any model decision, incl. skips |

## Rules
- `run.result` always fires. `hint.*` fires only when `status != pass` (the cascade).
- `source` may be `null` forever; the source card is additive and never blocks the hint.
- Every event carries `run_id` except transcript events, which carry `session_id` only.
- The frontend must render a usable screen from `run.result` alone. Hints decorate it.
