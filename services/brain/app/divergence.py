"""Turn a RunResult into a reasoning claim.

The product line is 'where your reasoning broke', so the prompt is built to forbid
the model from describing the diff. It must state a belief the student appears to hold.
"""
from __future__ import annotations

import json
from typing import Any

from .llm.openai_client import complete_json
from .ladder import normalize
from .prompts import loader


def analyze(run: dict[str, Any]) -> dict[str, Any]:
    """Returns {divergence, ladder, mistake_tag}. One model call."""
    payload = {
        "problem_id": run["problem_id"],
        "student_code": run["student_code"],
        "failing_input": (run.get("failing_input") or {}).get("repr"),
        "expected": run.get("expected"),
        "actual": run.get("actual"),
        "exception": run.get("exception"),
        "prediction": run.get("prediction"),
        # History matters: a hint that re-proposes an abandoned approach reads as noise.
        "history": [
            {"edit": h.get("edit_summary"), "status": h.get("run_status")}
            for h in run.get("history", [])[-6:]
        ],
    }

    raw = complete_json(
        system=loader.load("divergence_system.txt"),
        user=json.dumps(payload, default=str),
    )

    return {
        "divergence": {
            "line": raw.get("line"),
            "span": raw.get("span"),
            "claim": raw.get("claim", ""),
            "student_belief": raw.get("student_belief", ""),
            "actual_behavior": raw.get("actual_behavior", ""),
        },
        "ladder": normalize(raw.get("ladder", [])),
        "mistake_tag": raw.get("mistake_tag", "unclassified"),
    }
