"""Build the SourceCard.

Two jobs, both about honesty:
  1. The quote is copied verbatim from the indexed sentence. Never rewritten.
  2. We check whether the note AGREES with the hint, and say so either way.
"""
from __future__ import annotations

import json
from typing import Any

from .search import MIN_SCORE

AGREEMENT_PROMPT = """You compare a tutoring claim against a sentence from a student's notes.
Reply JSON only: {"agrees": boolean, "conflict_note": string|null}
"agrees" is false ONLY if the note states something incompatible with the claim.
A note that is merely unrelated is not a conflict - return agrees:true, conflict_note:null.
If false, conflict_note is one sentence naming the incompatibility."""


def build_card(claim: str, hits: list[dict[str, Any]], judge) -> dict[str, Any] | None:
    """`judge` is a complete_json-style callable. Returns None when nothing is good enough."""
    if not hits or hits[0]["score"] < MIN_SCORE:
        return None

    top = hits[0]
    verdict = judge(
        system=AGREEMENT_PROMPT,
        user=json.dumps({"claim": claim, "note_sentence": top["text"]}),
    )

    return {
        "doc_id": top["doc_id"],
        "title": top["title"],
        "page": top.get("page"),
        "quote": top["text"],  # verbatim, by construction
        "char_span": top.get("char_span"),
        "score": top["score"],
        "agrees_with_notes": bool(verdict.get("agrees", True)),
        "conflict_note": verdict.get("conflict_note"),
        "deep_link": f"https://www.dropbox.com/home/notes/{top['title']}#page={top.get('page', 1)}",
    }
