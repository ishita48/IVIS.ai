"""Proof engine API. Truth only - no model calls originate here."""
from __future__ import annotations

import uuid

from fastapi import FastAPI, HTTPException

from . import cascade, history
from .differ import find_divergence
from .sandbox import run_once
from .schemas import FailingInput, Prediction, RunRequest, RunResult
from .shrink import shrink

app = FastAPI(title="lens-proof-engine")

_RUNS: dict[str, RunResult] = {}
PROBLEMS = {"max-subarray": {"entry": "max_subarray", "reference_id": "max-subarray@kadane"}}


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/v1/runs")
def create_run(req: RunRequest) -> dict:
    problem = PROBLEMS.get(req.problem_id)
    if not problem:
        raise HTTPException(404, f"unknown problem {req.problem_id}")

    entry = problem["entry"]
    reference_src = _load_reference(req.problem_id)
    div = find_divergence(req.code, reference_src, entry)

    run_id = str(uuid.uuid4())
    status = "pass" if div is None else ("error" if div.student.exception else "fail")
    failing: FailingInput | None = None
    expected = actual = None
    runtime_ms = 0

    if div is not None:
        def still_fails(cand: list) -> bool:
            ref = run_once(reference_src, entry, cand)
            got = run_once(req.code, entry, cand)
            return ref.ok and (not got.ok or got.value != ref.value)

        small, steps = shrink(div.args, still_fails)
        small_ref = run_once(reference_src, entry, small)
        small_got = run_once(req.code, entry, small)

        failing = FailingInput(
            args=small,
            repr=_render(entry, small),
            shrunk=small != div.args,
            shrink_steps=steps,
            original_repr=_render(entry, div.args),
        )
        expected, actual = small_ref.value, small_got.value
        runtime_ms = small_got.runtime_ms

    history.record(req.session_id, req.code, status, failing.repr if failing else None, None)
    woke = cascade.should_wake_model(status, req.session_id)

    result = RunResult(
        run_id=run_id,
        session_id=req.session_id,
        problem_id=req.problem_id,
        status=status,  # type: ignore[arg-type]
        student_code=req.code,
        reference_id=problem["reference_id"],
        failing_input=failing,
        expected=expected,
        actual=actual,
        exception=div.student.exception if div else None,
        runtime_ms=runtime_ms,
        history=history.get(req.session_id),
        prediction=_score_prediction(req.prediction, expected, actual),
        woke_model=woke,
        tokens_saved=cascade.skipped(req.session_id),
    )
    _RUNS[run_id] = result
    return {"run_id": run_id, "status": status, "woke_model": woke}


@app.get("/v1/runs/{run_id}", response_model=RunResult)
def get_run(run_id: str) -> RunResult:
    if run_id not in _RUNS:
        raise HTTPException(404, "no such run")
    return _RUNS[run_id]


def _score_prediction(pred: str | None, expected, actual) -> Prediction | None:
    if not pred:
        return None
    return Prediction(
        predicted_output=pred,
        matched_actual=pred.strip() == str(actual),
        matched_expected=pred.strip() == str(expected),
    )


def _render(entry: str, args: list) -> str:
    return f"{entry}({', '.join(repr(a) for a in args)})"


def _load_reference(problem_id: str) -> str:
    from pathlib import Path
    return (Path(__file__).parent.parent / "reference" / f"{problem_id}.py").read_text()
