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
