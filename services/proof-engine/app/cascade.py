"""The cascade. The model wakes only on a failed check.

This is the efficiency claim the token counter renders, so the rule lives in exactly
one place and every skip is counted.
"""
from __future__ import annotations

from collections import defaultdict

_SKIPPED: dict[str, int] = defaultdict(int)


def should_wake_model(status: str, session_id: str) -> bool:
    if status == "pass":
        _SKIPPED[session_id] += 1
        return False
    return True


def skipped(session_id: str) -> int:
    return _SKIPPED[session_id]
