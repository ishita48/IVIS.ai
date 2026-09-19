# sources — the source tier

Owner: Fullstack. The student's own notes, quoted verbatim, or nothing at all.

```
ingest:   Dropbox folder -> PDF text -> sentence chunks -> Elastic (lens-notes)
retrieve: claim -> nearest sentences -> verbatim quote + agreement check
```

**Rule: the quote is copied, never generated.** If retrieval can't find a real sentence
that speaks to the claim, we return null and the source card does not render. A hallucinated
citation on stage is worse than no citation.

**Second rule: disagreement is shown, not hidden.** If the notes contradict the hint,
the card renders as a conflict. That is a feature — the student's notes may be wrong,
or the hint may be, and either is worth knowing.
