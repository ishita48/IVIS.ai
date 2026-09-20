# 09-token-company

The cost-saving move is refusing to call the model at all.
`apps/lens/lib/frame-cascade.ts`'s `decideCascade` gates every vision call
three ways — an identical frame hash, the client reporting
`sceneChanged: false`, or a repeat of the same objective inside a
four-second throttle — and hands back the prior observation instead of
paying for a new one. Every skip, and every call that does go through, lands
as a row in the same `events` collection: `recordSkip` and `recordCall` in
`apps/lens/lib/token-ledger.ts` are the two entry points, and `recordCall` is
live at five call sites (`vision.ts`, `llm.ts`, `guide.ts`, `pointer.ts`,
`embeddings.ts`) with the real `tokensIn`/`tokensOut` each provider reported.
`lib/metrics.ts` aggregates both into the skip count and token spend the
metrics strip shows live.

**No before/after number exists yet.** Nobody has run one session with the
cascade on and the same session with it off and compared the two — the
mechanism is real and live, the comparison is not.

**Lives in:** `apps/lens/lib/frame-cascade.ts`, `apps/lens/lib/token-ledger.ts`
