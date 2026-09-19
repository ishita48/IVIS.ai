"""OpenAI call with a strict JSON contract and a local fallback.

Called only when the cascade says a check failed. If this module gets chatty,
the token counter on stage stops being impressive - keep it to one call per failed run.
"""
from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAI

MODEL = os.getenv("LENS_MODEL", "gpt-4.1-mini")
_client: OpenAI | None = None

last_usage: dict[str, Any] = {}


def _get() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


def complete_json(system: str, user: str) -> dict[str, Any]:
    global last_usage
    try:
        resp = _get().chat.completions.create(
            model=MODEL,
            response_format={"type": "json_object"},
            temperature=0.2,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
    except Exception as exc:  # noqa: BLE001 - the demo must not die on a 429
        from .local_gx10 import complete_json as local
        last_usage = {"model": "gx10-local", "local": True, "fallback_reason": str(exc)[:120]}
        return local(system, user)

    usage = resp.usage
    last_usage = {
        "prompt": usage.prompt_tokens if usage else 0,
        "completion": usage.completion_tokens if usage else 0,
        "model": MODEL,
        "local": False,
    }
    return json.loads(resp.choices[0].message.content or "{}")
