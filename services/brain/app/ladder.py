"""The hint ladder.

Five rungs, one model call. The student climbs; nobody jumps to the fix.

  0 nudge     - a question, reveals nothing
  1 locate    - which line disagrees, and on what class of input
  2 cause     - name the misconception
  3 strategy  - what kind of change fixes it
  4 fix       - the change itself
"""
from __future__ import annotations

from typing import Any

REVEALS = ["nothing", "location", "cause", "strategy", "fix"]
LADDER_SIZE = 5


def redact(ladder: list[dict[str, Any]], unlocked: int) -> list[dict[str, Any]]:
    """Strip text above the unlocked rung. Called on every response, no exceptions -
    the client must never hold a hint the student has not earned."""
    return [
        {**r, "text": r.get("text") if r["rung"] <= unlocked else None}
        for r in ladder
    ]


def normalize(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Force the model's output into exactly five well-formed rungs."""
    out: list[dict[str, Any]] = []
    for i in range(LADDER_SIZE):
        item = raw[i] if i < len(raw) else {}
        out.append({
            "rung": i,
            "text": (item.get("text") or "").strip() or _fallback(i),
            "reveals": REVEALS[i],
        })
    return out


def _fallback(rung: int) -> str:
    return [
        "What input would make your answer and the correct answer differ most?",
        "The disagreement is on one line - find the line that behaves differently on the failing case.",
        "Your assumption about that line does not hold for this class of input.",
        "Change what the loop starts from, not what it does each step.",
        "Initialize from the first element instead of zero.",
    ][rung]
