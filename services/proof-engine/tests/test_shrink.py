import pytest

from app.shrink import shrink


def test_shrinks_all_negative_array_to_minimum_reproducer():
    """Any all-negative list fails the 'reset to 0' bug, so the shrinker should
    reduce a long one to a short one and stop."""
    def still_fails(args):
        return all(n < 0 for n in args[0]) and len(args[0]) >= 1

    small, steps = shrink([[-3, -1, -7, -4, -9, -2]], still_fails)
    assert len(small[0]) < 6
    assert all(n < 0 for n in small[0])
    assert steps > 0


@pytest.mark.parametrize(
    "args",
    [[], [[]], [[0]], [[-1]]],
    ids=["no-arguments", "empty-list", "zero", "negative-one"],
)
def test_already_minimal_failing_inputs_are_preserved(args):
    """A minimal reproducer must survive without losing its failure."""
    def still_fails(candidate):
        return candidate == args

    small, steps = shrink(args, still_fails)

    assert small == args
    assert 0 <= steps <= 1


def test_input_is_unchanged_when_no_candidate_reproduces_a_failure():
    """Passing candidates must never replace the original input."""
    args = [[-8, 6, 3]]
    candidates = []

    def still_fails(candidate):
        candidates.append(candidate)
        return False

    small, steps = shrink(args, still_fails)

    assert small == [[-8, 6, 3]]
    assert steps == len(candidates) > 0


@pytest.mark.parametrize(
    "arg",
    [7, -7, 1.5, "keep me", (1, 2), {"value": 3}, None],
    ids=["positive", "negative", "float", "string", "tuple", "dict", "null"],
)
def test_non_list_arguments_are_preserved_without_probing_candidates(arg):
    """Unsupported argument shapes must not be rewritten or crash shrinking."""
    def still_fails(candidate):
        pytest.fail("Non-list arguments have no shrink candidates")

    assert shrink([arg], still_fails) == ([arg], 0)


def test_multiple_list_arguments_shrink_without_changing_scalar_arguments():
    """A reproducer must keep argument order and every required failure."""
    args = [[-8, -3], "context", [9, 4]]

    def still_fails(candidate):
        return (
            len(candidate) == 3
            and candidate[1] == "context"
            and any(value < 0 for value in candidate[0])
            and any(value > 0 for value in candidate[2])
        )

    small, _ = shrink(args, still_fails)

    assert small == [[-1], "context", [1]]
    assert args == [[-8, -3], "context", [9, 4]]


def test_non_monotonic_failures_stop_at_a_valid_local_minimum():
    """Disconnected failing inputs must not cause endless shrinking."""
    calls = 0

    def still_fails(candidate):
        nonlocal calls
        calls += 1
        assert calls <= 60
        return len(candidate[0]) in (1, 3) and sum(candidate[0]) % 2 == 1

    small, steps = shrink([[-7, -3, -1]], still_fails)

    assert len(small[0]) in (1, 3)
    assert all(value == -1 for value in small[0])
    assert steps == calls < 60


@pytest.mark.xfail(
    reason=(
        "shrink increments steps after max_steps: it reports 19 steps "
        "for 2 predicate calls with max_steps=2"
    ),
    raises=AssertionError,
    strict=True,
)
def test_non_monotonic_search_reports_only_steps_within_its_budget():
    """The step count must reflect the bounded work spent on a reproducer."""
    args = [[1, 3, 5, 7, 9]]
    calls = 0

    def still_fails(candidate):
        nonlocal calls
        calls += 1
        return len(candidate[0]) % 2 == 1

    small, steps = shrink(args, still_fails, max_steps=2)

    assert small == args
    assert steps == calls <= 2
