# Architecture

```
                         ┌──────────────┐
  browser  ──────────────│   gateway    │──────── SSE ────────▶ browser
  (editor, mic,          │  :8000       │
   ladder, cards)        └───┬───┬───┬──┘
                             │   │   │
              ┌──────────────┘   │   └──────────────┐
              ▼                  ▼                  ▼
      ┌───────────────┐  ┌──────────────┐  ┌──────────────┐
      │ proof-engine  │  │    brain     │  │   sources    │
      │    :8001      │  │    :8002     │  │    :8003     │
      │               │  │              │  │              │
      │ sandbox       │  │ divergence   │  │ dropbox sync │
      │ differ        │  │ ladder (x5)  │  │ pdf parse    │
      │ shrink        │  │ openai       │  │ chunk        │
      │ history       │  │ gx10 local   │  │ elastic bm25 │
      │ cascade ◀─────┼──┤ embeddings   │  │   + knn      │
      └───────────────┘  └──────┬───────┘  └──────┬───────┘
                                │                 │
                                └────► Elastic ◀──┘
                                  lens-mistakes / lens-notes
```

## The one idea

A model is expensive and confidently wrong. A checker is cheap and always right about
*whether* something is wrong — it just can't say why.

So: **the checker decides, the model explains, and the model only ever speaks after the
checker has already found a concrete failing case.** The token counter in the header is
that architecture made visible — most runs never wake the model at all.

## Why each piece exists

- **shrink** — a 40-element failing array teaches nothing. `[-3, -1, -7]` teaches the lesson.
- **ladder** — five rungs in one model call, revealed one at a time, redacted server-side.
  Generating on demand would be five calls and five chances to contradict itself.
- **history** — a hint that re-proposes an approach the student abandoned two runs ago
  reads as noise. The brain sees what they already tried.
- **source tier** — the claim is grounded in the student's *own* notes, quoted verbatim.
  If retrieval finds nothing above threshold, no card renders. Never a generated citation.
- **mistake memory** — embeds the claim, not the code, so the same misconception across
  two different problems lands in the same neighborhood.
- **local model last** — venue wifi dies during judging. `LENS_FORCE_LOCAL=1` keeps the loop alive.

## Degradation ladder (what dies first)

1. sources down → no source card, everything else works
2. elastic down → no mistake sidebar, hints still work
3. openai down → GX10 local model, slower hints
4. brain down → checker still renders the failing input + expected/actual
5. gateway down → nothing works. This is the one to keep alive.
