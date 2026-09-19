# Engineering rules — read before you write a line

These exist because the difference between a HackMIT winner and a slick
demo full of pre-recorded JSON is usually one shortcut taken at hour 30.

## 1. No hardcoding, no simulation

Every observation, hint, question, and verification the student sees must
be either:

- the direct output of a live model call on live input (a frame captured
  seconds ago, code they just typed), or
- a real deterministic computation on real data (an execution result, a
  retrieved chunk, a vector-search score, a Mongo aggregation).

No happy path may branch on a hardcoded string match, a fixture file
standing in for a model response, or a step counter faking progression.

**The one allowed exception** is the labeled offline replay in §19 of the
PDR: a cached last-good observation, visibly marked "offline replay",
shown only after two consecutive live failures. Never the default, never
silent.

## 2. Fail loudly

A vision call that fails shows an error and stops the state machine. It
does not quietly reuse the previous observation. If you catch an error and
substitute plausible content, you have built something that will lie to
you on stage and you will not know until a judge asks a follow-up.

## 3. Enforce the product rule in code, not in prompts

A prompt is a request; code is a guarantee. Two places already do this —
match the pattern when you add features:

- `normalizeObservation()` in `lib/vision.ts` forces
  `shouldRevealAnswer: false`. The "direct answers: 0" metric cannot be
  undermined by a model having an off day.
- `nextAllowedLevel()` in `lib/reasoning.ts` caps the hint ladder by
  counting real student attempts. The model cannot skip to EXPLAIN because
  it is impatient.

## 4. Metrics are queries, never counters

Nothing in `lib/store.ts` increments a demo number. `MetricsStrip` renders
`/api/metrics`, which aggregates the `events` collection. If you want a new
number on stage, write the event and add the aggregation — do not add
`useState(0)`.

## 5. Record events generously

An event that was never written is a demo beat that cannot be replayed, a
reasoning inference that cannot be grounded, and a metric that reads zero.
When in doubt, `recordEvent`.

## 6. Under two events, LENS says "not enough evidence"

`analyzeReasoning` refuses to infer a misconception from a single frame.
That refusal is a feature — point at it during the demo. A tutor that is
confidently wrong about what you believe is worse than one that waits.

## 7. Don't add these back

Continuous camera polling, a second orchestrator next to the LENS agent, a
new auth system, a new database, Postgres/Supabase, or all twelve sponsor
integrations. Each was cut deliberately in §6.4 of the PDR. If you are
about to re-add one at hour 30, you are not adding a feature, you are
adding a way to fail.
