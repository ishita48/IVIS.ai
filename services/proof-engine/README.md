# proof-engine — right vs wrong

Owner: Backend 1. Decides truth. Never calls a model.

```
POST /v1/runs        -> {run_id}        run student code, diff against reference
GET  /v1/runs/{id}   -> RunResult
GET  /health
```

Pipeline: `sandbox` → `differ` → `shrink` → `history` → `cascade`.
Only `cascade` decides whether the Brain gets woken, and it says no on every passing run.

Emits `RunResult` (see `/contracts/run_result.schema.json`). That shape is frozen — if it
changes here, the fixture changes in the same commit.
