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
