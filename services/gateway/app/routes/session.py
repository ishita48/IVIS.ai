from __future__ import annotations

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from .. import sse

router = APIRouter()


@router.get("/v1/sessions/{session_id}/stream")
async def stream(session_id: str, request: Request) -> EventSourceResponse:
    q = sse.subscribe(session_id)

    async def gen():
        try:
            while True:
                if await request.is_disconnected():
                    break
                item = await q.get()
                yield item
        finally:
            sse.unsubscribe(session_id, q)

    return EventSourceResponse(gen())
