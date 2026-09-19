"""Elastic as the student's mistake memory.

Index: lens-mistakes. One doc per diagnosed failure, kNN over the mistake vector.
This is what makes the sidebar say 'third time this session' instead of nothing.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from elasticsearch import Elasticsearch

INDEX = "lens-mistakes"
_es: Elasticsearch | None = None

MAPPING: dict[str, Any] = {
    "mappings": {
        "properties": {
            "session_id": {"type": "keyword"},
            "run_id": {"type": "keyword"},
            "problem_id": {"type": "keyword"},
            "tag": {"type": "keyword"},
            "claim": {"type": "text"},
            "student_belief": {"type": "text"},
            "ts": {"type": "date"},
            "vector": {"type": "dense_vector", "dims": 1536, "index": True, "similarity": "cosine"},
        }
    }
}


def client() -> Elasticsearch:
    global _es
    if _es is None:
        _es = Elasticsearch(os.getenv("ELASTIC_URL", "http://localhost:9200"))
    return _es


def ensure_index() -> None:
    es = client()
    if not es.indices.exists(index=INDEX):
        es.indices.create(index=INDEX, body=MAPPING)


def remember(session_id: str, run_id: str, problem_id: str, tag: str, claim: str, belief: str, vector: list[float]) -> None:
    client().index(
        index=INDEX,
        document={
            "session_id": session_id,
            "run_id": run_id,
            "problem_id": problem_id,
            "tag": tag,
            "claim": claim,
            "student_belief": belief,
            "ts": datetime.now(timezone.utc),
            "vector": vector,
        },
    )


def recall(session_id: str, vector: list[float], k: int = 5) -> dict[str, Any]:
    """Nearest prior mistakes for THIS student. Returns {recurrence, first_seen, prior_run_ids}."""
    res = client().search(
        index=INDEX,
        knn={"field": "vector", "query_vector": vector, "k": k, "num_candidates": 50},
        query={"term": {"session_id": session_id}},
        size=k,
    )
    hits = res.get("hits", {}).get("hits", [])
    return {
        "recurrence": len(hits),
        "first_seen": hits[-1]["_source"]["ts"] if hits else None,
        "prior_run_ids": [h["_source"]["run_id"] for h in hits],
    }
