import pytest

from app.ladder import normalize, redact


def test_locked_rungs_ship_without_text():
    """Redaction is the product. A locked rung must not carry its text to the client."""
    ladder = normalize([{"text": f"rung {i}"} for i in range(5)])
    out = redact(ladder, unlocked=1)

    assert [r["text"] for r in out][:2] == ["rung 0", "rung 1"]
    assert all(r["text"] is None for r in out[2:])


def test_normalize_always_returns_five_well_formed_rungs():
    out = normalize([{"text": "only one"}])
    assert len(out) == 5
    assert all(r["text"] for r in out)
    assert [r["reveals"] for r in out] == ["nothing", "location", "cause", "strategy", "fix"]


@pytest.mark.parametrize("rung_count", [0, 1, 4, 5, 6, 8])
@pytest.mark.parametrize("unlocked", [-1, 0, 1, 2, 3, 4, 5])
def test_model_ladder_length_never_exposes_text_above_the_unlocked_rung(
    rung_count, unlocked
):
    """Missing and surplus model rungs must not bypass server redaction."""
    raw = [{"text": f"private rung {i}"} for i in range(rung_count)]
    ladder = normalize(raw)

    out = redact(ladder, unlocked)
    visible_count = max(0, min(unlocked + 1, 5))

    assert [r["rung"] for r in out] == [0, 1, 2, 3, 4]
    assert [r["text"] for r in out[:visible_count]] == [
        r["text"] for r in ladder[:visible_count]
    ]
    assert [r["text"] for r in out[visible_count:]] == [None] * (5 - visible_count)


@pytest.mark.parametrize(
    "item",
    [{"text": ""}, {"text": " \t\n "}, {"text": None}, {}],
    ids=["empty", "whitespace", "null", "missing"],
)
@pytest.mark.parametrize("unlocked", [-1, 0, 1, 2, 3, 4, 5])
def test_fallback_text_for_empty_model_rungs_is_redacted_until_unlocked(
    item, unlocked
):
    """Fallback hints can reveal the fix and need the same lock as model text."""
    ladder = normalize([dict(item) for _ in range(5)])

    out = redact(ladder, unlocked)

    assert all(isinstance(r["text"], str) and r["text"].strip() for r in ladder)
    assert [r["text"] for r in out] == [
        ladder[i]["text"] if i <= unlocked else None for i in range(5)
    ]


@pytest.mark.parametrize("model_rung", [-1, 0, 4, 99, None, "0"])
def test_model_supplied_rung_numbers_cannot_unlock_later_hint_text(model_rung):
    """The model cannot grant access by labeling every hint as a nudge."""
    raw = [
        {"rung": model_rung, "text": f"private rung {i}"}
        for i in range(5)
    ]

    out = redact(normalize(raw), unlocked=0)

    assert [r["rung"] for r in out] == [0, 1, 2, 3, 4]
    assert [r["text"] for r in out] == ["private rung 0", None, None, None, None]


def test_redaction_uses_rung_numbers_when_the_ladder_is_reordered():
    """A locked fix must stay hidden even when it arrives before the nudge."""
    ladder = normalize([{"text": f"private rung {i}"} for i in range(5)])

    out = redact(list(reversed(ladder)), unlocked=0)

    assert [r["text"] for r in out] == [None, None, None, None, "private rung 0"]


def test_redacting_a_shared_ladder_does_not_destroy_hints_for_later_unlocks():
    """Students must still earn each hint after an earlier redacted response."""
    ladder = normalize([{"text": f"private rung {i}"} for i in range(5)])

    locked = redact(ladder, unlocked=0)
    unlocked = redact(ladder, unlocked=4)

    assert [r["text"] for r in unlocked] == [f"private rung {i}" for i in range(5)]
    assert [r["text"] for r in locked] == ["private rung 0", None, None, None, None]
