"""Hybrid retrieval over the student's notes."""
from __future__ import annotations

import os
from typing import Any

from elasticsearch import Elasticsearch

INDEX = "lens-notes"
MIN_SCORE = 0.62  # below this we return nothing rather than a weak citation


def search(claim: str, vector: list[float], k: int = 3) -> list[dict[str, Any]]:
    es = Elasticsearch(os.getenv("ELASTIC_URL", "http://localhost:9200"))
    res = es.search(
        index=INDEX,
        size=k,
        query={"match": {"text": {"query": claim, "boost": 0.3}}},
        knn={"field": "vector", "query_vector": vector, "k": k, "num_candidates": 50, "boost": 0.7},
    )
    hits = res.get("hits", {}).get("hits", [])
    return [{**h["_source"], "score": h["_score"]} for h in hits]
