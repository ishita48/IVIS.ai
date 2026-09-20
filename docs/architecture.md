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
      │ history       │  │              │  │ elastic bm25 │
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
- **no local fallback** — there is no on-prem model and no `LENS_FORCE_LOCAL`. If the
  network dies mid-demo the loop dies with it; the answer is the backup video, said
  plainly. Do not claim a fallback we do not have.

## Degradation ladder (what dies first)

1. sources down → no source card, everything else works
2. elastic down → no mistake sidebar, hints still work
3. openai down → no hints at all. There is no local model to fall back to.
4. brain down → checker still renders the failing input + expected/actual
5. gateway down → nothing works. This is the one to keep alive.
