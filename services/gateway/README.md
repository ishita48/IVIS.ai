# gateway — the only thing the browser talks to

Owner: Fullstack. Fans out to proof-engine, brain and sources; fans in one SSE stream.

```
POST /v1/runs                       -> {run_id}
POST /v1/hints/{run_id}/unlock      -> {rung}
GET  /v1/sessions/{id}/stream       -> SSE (see contracts/events.md)
GET  /v1/voice/deepgram-token       -> short-lived key for the browser
POST /v1/voice/speak                -> audio/mpeg
```

The frontend depends on this service and nothing else. If proof-engine or brain is
down, this service still returns a usable stream — degraded, never blank.
