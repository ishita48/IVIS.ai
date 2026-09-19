"""Differential testing: student code vs a reference solution on generated inputs.

Returns the FIRST disagreement, unshrunk. `shrink.py` makes it small before it ships.
"""
from __future__ import annotations

from dataclasses import dataclass

from .generators import cases
from .sandbox import ExecOutcome, run_once


@dataclass
class Divergence:
    args: list
    expected: object
    actual: object
    student: ExecOutcome
    checked: int


def find_divergence(
    student_src: str, reference_src: str, entry: str, kind: str = "int_list", budget: int = 200
) -> Divergence | None:
    """None means the student agreed with the reference on every case we tried."""
    checked = 0
    for args in cases(kind, budget=budget):
        checked += 1
        ref = run_once(reference_src, entry, args)
        if not ref.ok:
            continue  # reference itself rejects this input; not the student's problem

        got = run_once(student_src, entry, args)
        if not got.ok or got.value != ref.value:
            return Divergence(args=args, expected=ref.value, actual=got.value, student=got, checked=checked)

    return None
