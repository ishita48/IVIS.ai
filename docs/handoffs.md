# Handoffs

Two handoffs. Both are JSON. Both are frozen in the first hour.

## 1. Backend 1 → Backend 2

```
{student_code, failing_input, expected, actual, history}
```

Full shape: [`contracts/run_result.schema.json`](../contracts/run_result.schema.json)

Guarantees Backend 2 can rely on:
- `failing_input` is already **shrunk**. Backend 2 never sees a 40-element array.
- `history` is oldest-first and capped at 20 entries.
- The brain is called **only** when `status != "pass"`. That is the cascade, and it is
  enforced in `proof-engine/app/cascade.py`, not by convention.

## 2. Backend 2 → Fullstack → Frontend

```
{divergence, rung, hint, source?}
```

Full shape: [`contracts/hint_response.schema.json`](../contracts/hint_response.schema.json)

Guarantees the Frontend can rely on:
- `ladder` is always exactly 5 entries, rungs 0–4, in order.
- Rungs above `rung` arrive with `text: null`. Redaction is **server-side** — do not
  ship the full ladder and hide it in CSS.
- `source` may be `null` forever. The source card is additive and never blocks a hint.

## Timing

`run.result` always fires first and must produce a usable screen on its own.
`hint.ready` decorates it. `source.ready` may trail by seconds or never arrive.
See [`contracts/events.md`](../contracts/events.md).

## Changing a contract
Edit schema → update fixture in the same commit → announce it. A contract change with
a stale fixture is how the demo dies at 4am.
