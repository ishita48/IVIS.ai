from __future__ import annotations

import os
from typing import Any

import httpx

BASE = os.getenv("BRAIN_URL", "http://localhost:8002")


async def hint(run_result: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=90) as c:
        r = await c.post(f"{BASE}/v1/hints", json=run_result)
        r.raise_for_status()
        return r.json()
