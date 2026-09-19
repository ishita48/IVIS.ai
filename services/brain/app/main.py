"""Brain API. Woken only by a failed check."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI

from .divergence import analyze
from .ladder import redact
from .llm import openai_client
from .memory import elastic, embeddings

app = FastAPI(title="lens-brain")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/v1/hints")
def make_hint(run: dict[str, Any]) -> dict[str, Any]:
    """RunResult in, HintResponse out. Memory and redaction are not optional paths."""
    result = analyze(run)
    div, ladder, tag = result["divergence"], result["ladder"], result["mistake_tag"]

    mistake: dict[str, Any] = {"tag": tag, "recurrence": 0, "prior_run_ids": [], "first_seen": None}
    try:
        vec = embeddings.embed_mistake(tag, div["claim"], div["student_belief"])
        mistake |= elastic.recall(run["session_id"], vec)
        elastic.remember(
            run["session_id"], run["run_id"], run["problem_id"],
            tag, div["claim"], div["student_belief"], vec,
        )
    except Exception as exc:  # noqa: BLE001 - memory is additive; never block the hint
        mistake["error"] = str(exc)[:120]

    unlocked = 0  # every hint starts at the bottom rung
    return {
        "run_id": run["run_id"],
        "session_id": run["session_id"],
        "divergence": div,
        "rung": unlocked,
        "ladder": redact(ladder, unlocked),
        "hint": {**ladder[unlocked], "text": ladder[unlocked]["text"]},
        "source": None,  # filled in by the gateway from the sources service
        "mistake": mistake,
        "tokens": openai_client.last_usage,
    }
