"""Mistake embeddings.

We embed the *claim + tag*, not the code. Two students hitting the same
misconception in different problems should land next to each other in the index;
two students with identical code and different misconceptions should not.
"""
from __future__ import annotations

import os

from openai import OpenAI

EMBED_MODEL = os.getenv("LENS_EMBED_MODEL", "text-embedding-3-small")
DIMS = 1536

_client: OpenAI | None = None


def _get() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


def embed_mistake(tag: str, claim: str, belief: str) -> list[float]:
    text = f"[{tag}] {claim} :: {belief}"
    resp = _get().embeddings.create(model=EMBED_MODEL, input=text)
    return resp.data[0].embedding
