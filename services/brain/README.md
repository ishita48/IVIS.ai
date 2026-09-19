# brain — hints + evidence

Owner: Backend 2. Turns a failed check into a claim about *reasoning*, not syntax.

```
POST /v1/hints   <- RunResult   -> HintResponse
GET  /health
```

- `divergence.py` — where the student's belief parted from the code's behavior
- `ladder.py` — five rungs in one call; the client reveals them one at a time
- `llm/` — OpenAI first, local GX10 as the last fallback
- `memory/` — mistake embeddings in Elastic; drives "you did this before"
- `bench/` — CodeNet → bug patterns → 20-bug benchmark, plain LLM vs LENS

**Redaction is enforced server-side.** Rungs above the unlocked one ship as `text: null`.
Never send the full ladder and let the client hide it.
