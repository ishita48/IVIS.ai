from __future__ import annotations

from fastapi import APIRouter

from ..clients import sources

router = APIRouter()


@router.get("/v1/sources/search")
async def search(claim: str, session_id: str) -> dict | None:
    return await sources.find(claim, session_id)
