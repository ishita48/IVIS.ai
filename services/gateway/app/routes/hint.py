from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from .. import sse

router = APIRouter()
_UNLOCKED: dict[str, int] = {}


class UnlockBody(BaseModel):
    rung: int


@router.post("/v1/hints/{run_id}/unlock")
async def unlock(run_id: str, body: UnlockBody, session_id: str) -> dict:
    """Climb one rung. Server-side so the ladder cannot be skipped from the client."""
    current = _UNLOCKED.get(run_id, 0)
    target = min(4, max(current, min(body.rung, current + 1)))
    _UNLOCKED[run_id] = target
    await sse.publish(session_id, "hint.unlocked", {"run_id": run_id, "rung": target})
    return {"rung": target}
