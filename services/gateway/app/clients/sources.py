from __future__ import annotations

import os
from typing import Any

import httpx

BASE = os.getenv("SOURCES_URL", "http://localhost:8003")


async def find(claim: str, session_id: str) -> dict[str, Any] | None:
    """Best-effort. A missing source card never blocks a hint."""
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(f"{BASE}/v1/search", json={"claim": claim, "session_id": session_id})
            r.raise_for_status()
            return r.json() or None
    except Exception:  # noqa: BLE001
        return None
