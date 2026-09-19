"""Sources API."""
from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

from retrieve.quote import build_card
from retrieve.search import search

app = FastAPI(title="lens-sources")


class SearchBody(BaseModel):
    claim: str
    session_id: str


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/v1/search")
def do_search(body: SearchBody) -> dict | None:
    from services.brain.app.llm.openai_client import complete_json  # shared judge
    from services.brain.app.memory.embeddings import embed_mistake

    vec = embed_mistake("claim", body.claim, "")
    hits = search(body.claim, vec)
    return build_card(body.claim, hits, complete_json)
