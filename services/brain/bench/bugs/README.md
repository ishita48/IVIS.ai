# 20-bug benchmark

`mined.jsonl` — raw (buggy, fixed) pairs from CodeNet, machine-mined.
`benchmark20.jsonl` — the curated 20. Hand-checked, one line each:

```json
{"id":"b01","problem_id":"max-subarray","buggy":"...","fixed":"...","truth_line":5,
 "tag":"empty-input-edge-case","run_result":{ ...RunResult fixture... }}
```

Selection rules — a case earns its slot only if:
1. The fix is ≤ 3 lines (otherwise "which line" has no answer).
2. The bug is a *reasoning* error, not a typo or a missing import.
3. A plain LLM could plausibly get it right — no stacked strawmen.

Keep the distribution honest: if LENS only wins on edge-case bugs, say that on the slide.
