"""The core loop, in one place.

run -> result on the wire -> (only if failed) hint -> (only if found) source.
Each step publishes as soon as it has something. Nothing waits on the step after it.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from .. import sse
from ..clients import brain, proof_engine, sources

router = APIRouter()


class RunBody(BaseModel):
    session_id: str
    problem_id: str
    code: str
    prediction: str | None = None


@router.post("/v1/runs")
async def create_run(body: RunBody) -> dict:
    ack = await proof_engine.submit(body.session_id, body.problem_id, body.code, body.prediction)
    run_id = ack["run_id"]
    await sse.publish(body.session_id, "run.started", {"run_id": run_id, "problem_id": body.problem_id})

    asyncio.create_task(_drive(body.session_id, run_id))
    return {"run_id": run_id}


async def _drive(session_id: str, run_id: str) -> None:
    result = await proof_engine.fetch(run_id)
    await sse.publish(session_id, "run.result", result)
    await sse.publish(session_id, "tokens.tick", {"saved": result["tokens_saved"], "used_total": 0})

    # The cascade. Passing runs cost nothing.
    if not result.get("woke_model"):
        return

    await sse.publish(session_id, "hint.pending", {"run_id": run_id})
    hint = await brain.hint(result)
    await sse.publish(session_id, "hint.ready", hint)

    card = await sources.find(hint["divergence"]["claim"], session_id)
    if card:
        await sse.publish(session_id, "source.ready", card)
