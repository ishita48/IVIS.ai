"""Pydantic mirror of /contracts/run_result.schema.json. The schema is the source of truth."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

RunStatus = Literal["pass", "fail", "error", "timeout"]


class FailingInput(BaseModel):
    args: list[Any] = Field(default_factory=list)
    repr: str = ""
    shrunk: bool = False
    shrink_steps: int = 0
    original_repr: str | None = None


class HistoryEntry(BaseModel):
    ts: datetime
    run_status: RunStatus
    edit_summary: str = ""
    diff: str = ""
    failing_input_repr: str | None = None
    hint_rung_shown: int | None = None


class Prediction(BaseModel):
    predicted_output: str
    matched_actual: bool
    matched_expected: bool


class RunResult(BaseModel):
    run_id: str
    session_id: str
    problem_id: str
    status: RunStatus

    student_code: str
    reference_id: str | None = None

    failing_input: FailingInput | None = None
    expected: Any = None
    actual: Any = None

    stdout: str = ""
    stderr: str = ""
    exception: str | None = None
    runtime_ms: int = 0

    history: list[HistoryEntry] = Field(default_factory=list)
    prediction: Prediction | None = None

    woke_model: bool = False
    tokens_saved: int = 0


class RunRequest(BaseModel):
    session_id: str
    problem_id: str
    code: str
    prediction: str | None = None
