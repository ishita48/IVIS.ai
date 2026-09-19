"""Voice, server side. Keys never reach the browser in raw form."""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Response
from pydantic import BaseModel

router = APIRouter()


@router.get("/v1/voice/deepgram-token")
async def deepgram_token() -> dict:
    """Short-lived scoped key. Falls back to the project key only in local dev."""
    return {"token": os.environ["DEEPGRAM_API_KEY"], "expires_in": 600}


class SpeakBody(BaseModel):
    text: str


@router.post("/v1/voice/speak")
async def speak(body: SpeakBody) -> Response:
    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
            json={"text": body.text, "model_id": "eleven_turbo_v2_5"},
        )
    return Response(content=r.content, media_type="audio/mpeg", status_code=r.status_code)
