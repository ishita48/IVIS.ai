from __future__ import annotations

import os
from typing import Any

import httpx

BASE = os.getenv("PROOF_ENGINE_URL", "http://localhost:8001")


async def submit(session_id: str, problem_id: str, code: str, prediction: str | None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{BASE}/v1/runs", json={
            "session_id": session_id, "problem_id": problem_id,
            "code": code, "prediction": prediction,
        })
        r.raise_for_status()
        return r.json()


async def fetch(run_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{BASE}/v1/runs/{run_id}")
        r.raise_for_status()
        return r.json()
