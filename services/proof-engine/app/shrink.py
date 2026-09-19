"""Delta-debugging shrinker.

A 40-element failing array teaches nothing. `[-3, -1, -7]` teaches the whole lesson.
Shrink before anything downstream - the brain, the UI and the student all see the small one.
"""
from __future__ import annotations

from typing import Callable

Fails = Callable[[list], bool]


def shrink(args: list, still_fails: Fails, max_steps: int = 60) -> tuple[list, int]:
    """Greedily minimize `args` while `still_fails` holds. Returns (smallest, steps_taken)."""
    best = args
    steps = 0

    def try_candidate(cand: list) -> bool:
        nonlocal best, steps
        steps += 1
        if steps > max_steps:
            return False
        if still_fails(cand):
            best = cand
            return True
        return False

    changed = True
    while changed and steps < max_steps:
        changed = False

        # 1. drop elements from list arguments
        for i, arg in enumerate(best):
            if not isinstance(arg, list) or len(arg) <= 1:
                continue
            for j in range(len(arg)):
                cand = list(best)
                cand[i] = arg[:j] + arg[j + 1 :]
                if try_candidate(cand):
                    changed = True
                    break
            if changed:
                break

        if changed:
            continue

        # 2. simplify surviving values toward zero
        for i, arg in enumerate(best):
            if not isinstance(arg, list):
                continue
            for j, v in enumerate(arg):
                if not isinstance(v, int) or v == 0:
                    continue
                for target in (0, v // 2, -1 if v < 0 else 1):
                    if target == v:
                        continue
                    cand = list(best)
                    inner = list(arg)
                    inner[j] = target
                    cand[i] = inner
                    if try_candidate(cand):
                        changed = True
                        break
                if changed:
                    break
            if changed:
                break

    return best, steps
