"""Sentence-level chunking.

Chunk small. The source card shows ONE sentence - if the chunk is a paragraph,
the card is a wall of text and nobody reads it on stage.
"""
from __future__ import annotations

import re

SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")
MIN_CHARS = 40


def sentences(doc: dict) -> list[dict]:
    out: list[dict] = []
    for page in doc["pages"]:
        offset = 0
        for sent in SENTENCE.split(page["text"]):
            clean = sent.strip()
            if len(clean) >= MIN_CHARS:
                out.append({
                    "doc_id": doc["doc_id"],
                    "title": doc["title"],
                    "page": page["page"],
                    "text": clean,
                    "char_span": [offset, offset + len(clean)],
                })
            offset += len(sent) + 1
    return out
