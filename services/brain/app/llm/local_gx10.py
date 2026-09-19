"""Local model on the GX10 box. Last resort, and the offline-demo story.

Same JSON contract as the hosted call. If the venue wifi dies during judging,
flipping LENS_FORCE_LOCAL=1 keeps the loop alive.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

ENDPOINT = os.getenv("GX10_ENDPOINT", "http://localhost:11434/v1/chat/completions")
MODEL = os.getenv("GX10_MODEL", "qwen2.5-coder:7b")


def complete_json(system: str, user: str) -> dict[str, Any]:
    resp = httpx.post(
        ENDPOINT,
        json={
            "model": MODEL,
            "format": "json",
            "temperature": 0.2,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        },
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {}
