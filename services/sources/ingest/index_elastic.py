"""Index note sentences into Elastic (hybrid: BM25 + vector)."""
from __future__ import annotations

import os
from typing import Any

from elasticsearch import Elasticsearch, helpers

INDEX = "lens-notes"

MAPPING: dict[str, Any] = {
    "mappings": {
        "properties": {
            "doc_id": {"type": "keyword"},
            "title": {"type": "keyword"},
            "page": {"type": "integer"},
            "text": {"type": "text"},
            "char_span": {"type": "integer"},
            "vector": {"type": "dense_vector", "dims": 1536, "index": True, "similarity": "cosine"},
        }
    }
}


def client() -> Elasticsearch:
    return Elasticsearch(os.getenv("ELASTIC_URL", "http://localhost:9200"))


def ensure_index(es: Elasticsearch) -> None:
    if not es.indices.exists(index=INDEX):
        es.indices.create(index=INDEX, body=MAPPING)


def bulk_index(chunks: list[dict], vectors: list[list[float]]) -> int:
    es = client()
    ensure_index(es)
    actions = [
        {"_index": INDEX, "_source": {**c, "vector": v}}
        for c, v in zip(chunks, vectors)
    ]
    ok, _ = helpers.bulk(es, actions)
    es.indices.refresh(index=INDEX)
    return ok
