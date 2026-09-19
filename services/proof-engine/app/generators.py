"""Input generation per problem.

Strategy beats volume: a problem declares the shapes that break naive solutions
(empty, all-negative, duplicates, single element) and we fuzz around those.
"""
from __future__ import annotations

import random
from typing import Callable, Iterator

Generator = Callable[[random.Random], list]


def int_list(lo: int = -20, hi: int = 20, max_len: int = 12) -> Generator:
    def gen(rng: random.Random) -> list:
        n = rng.randint(0, max_len)
        return [[rng.randint(lo, hi) for _ in range(n)]]
    return gen


# Edge cases are tried first, in order, before any random draw. Most student bugs
# die on one of these, which keeps the model asleep and the token counter climbing.
EDGE_CASES: dict[str, list[list]] = {
    "int_list": [[[]], [[0]], [[-1]], [[-3, -1, -7]], [[1]], [[5, 5, 5]], [[-1, 2, -1]]],
}


def cases(kind: str, seed: int = 0, budget: int = 200) -> Iterator[list]:
    yield from EDGE_CASES.get(kind, [])
    rng = random.Random(seed)
    gen = int_list()
    for _ in range(budget):
        yield gen(rng)
