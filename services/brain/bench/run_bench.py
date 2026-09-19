"""20-bug benchmark: plain LLM vs LENS.

The number that goes on the slide. Both arms see the same bug; only LENS also sees
a shrunk failing input and edit history.

Scored on:
  located   - did it name the right line?
  diagnosed - did it name the misconception, not the symptom?
  leaked    - did rung 0 give away the fix? (LENS must be 0 here; that is the point)
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.divergence import analyze
from app.llm.openai_client import complete_json

PLAIN_PROMPT = "You are a helpful tutor. The student's code is below. Help them."


def arm_plain(case: dict) -> dict:
    out = complete_json(
        system=PLAIN_PROMPT + " Reply JSON: {line, claim, gives_fix:boolean}",
        user=json.dumps({"student_code": case["buggy"]}),
    )
    return {"line": out.get("line"), "claim": out.get("claim", ""), "leaked": bool(out.get("gives_fix"))}


def arm_lens(case: dict) -> dict:
    out = analyze(case["run_result"])
    return {
        "line": out["divergence"]["line"],
        "claim": out["divergence"]["claim"],
        "leaked": _leaks(out["ladder"][0]["text"]),
    }


def _leaks(rung0: str) -> bool:
    """Rung 0 is a question. If it contains a fix verb or a code token, it leaked."""
    bad = ("initialize", "change", "replace", "use ", "=", "return ")
    return any(b in rung0.lower() for b in bad)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=Path, default=Path("bench/bugs/benchmark20.jsonl"))
    ap.add_argument("--out", type=Path, default=Path("bench/results/latest.json"))
    args = ap.parse_args()

    cases = [json.loads(l) for l in args.cases.read_text().splitlines() if l.strip()]
    rows = []
    for c in cases:
        rows.append({"id": c["id"], "plain": arm_plain(c), "lens": arm_lens(c), "truth_line": c["truth_line"]})

    summary = {
        arm: {
            "located": sum(r[arm]["line"] == r["truth_line"] for r in rows) / len(rows),
            "leaked": sum(r[arm]["leaked"] for r in rows) / len(rows),
        }
        for arm in ("plain", "lens")
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"summary": summary, "rows": rows}, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
