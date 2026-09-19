"""Edit + run history, per session.

The brain's most useful input after the failing case: what they already tried.
A hint that repeats an approach the student abandoned two runs ago reads as noise.
"""
from __future__ import annotations

import difflib
from collections import defaultdict
from datetime import datetime, timezone

from .schemas import HistoryEntry

_HISTORY: dict[str, list[HistoryEntry]] = defaultdict(list)
_LAST_CODE: dict[str, str] = {}
MAX_SHIPPED = 20


def record(session_id: str, code: str, status: str, failing_repr: str | None, rung_shown: int | None) -> None:
    prev = _LAST_CODE.get(session_id, "")
    diff = "".join(
        difflib.unified_diff(prev.splitlines(keepends=True), code.splitlines(keepends=True), n=1)
    ) if prev else ""

    _HISTORY[session_id].append(
        HistoryEntry(
            ts=datetime.now(timezone.utc),
            run_status=status,  # type: ignore[arg-type]
            edit_summary=summarize(prev, code),
            diff=diff,
            failing_input_repr=failing_repr,
            hint_rung_shown=rung_shown,
        )
    )
    _LAST_CODE[session_id] = code


def summarize(prev: str, cur: str) -> str:
    """One line, human-readable. Cheap heuristics beat a model call here."""
    if not prev:
        return "first submission"
    pl, cl = prev.splitlines(), cur.splitlines()
    if len(cl) > len(pl):
        return f"added {len(cl) - len(pl)} line(s)"
    if len(cl) < len(pl):
        return f"removed {len(pl) - len(cl)} line(s)"
    changed = [i for i, (a, b) in enumerate(zip(pl, cl), 1) if a != b]
    return f"edited line {changed[0]}" if len(changed) == 1 else f"edited {len(changed)} lines"


def get(session_id: str) -> list[HistoryEntry]:
    return _HISTORY[session_id][-MAX_SHIPPED:]
