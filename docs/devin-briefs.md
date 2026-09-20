# Overnight agent briefs

Four Devin sessions, launched before sleep, reviewed before H+18. Each brief is written to
be pasted whole into a new session. They touch disjoint files on purpose — two agents in the
same directory produce two PRs that conflict, and untangling that at 8am costs more than the
work saved.

Repo rules live in [`AGENTS.md`](../AGENTS.md). Devin re-reads that every session; these
briefs only say what is specific to the task.

Launch order matters. **Start with #1** — it comes back fastest and tells you whether the
machine snapshot is actually working before you spend ACUs on the other three.

---

## 1 — Sponsor blurbs

> Fill in all twelve files in `demo/blurbs/`. Each is currently an empty template.
>
> Rules are in `demo/blurbs/README.md` and the sponsor→file map is in `docs/sponsors.md`.
> Read both first. Then, for each sponsor, open the file it claims the integration lives in
> and read the actual code before you write a word about it.
>
> Each blurb is 2–4 sentences plus the `**Lives in:**` line filled with a real path. Lead
> with what the integration does for a student using LENS, not with the fact that we used
> the sponsor. Include one concrete number or file path per blurb.
>
> Two things that will get the PR closed: naming a file that does not exist in the tree, or
> claiming an integration that is not actually wired. If you open the file listed in
> `docs/sponsors.md` and find a stub, say so in the PR body and write the blurb to describe
> only what is really there.
>
> Leave `11-cognition.md` as the empty template — a human fills that one.
>
> Scope: `demo/blurbs/*.md` only. No code.

---

## 2 — Benchmark dataset

> `services/brain/bench/run_bench.py` is written and expects a file that does not exist:
> `services/brain/bench/bugs/benchmark20.jsonl`. Build that file.
>
> The line schema and the three selection rules are in `services/brain/bench/bugs/README.md`.
> Follow the rules literally — especially "the fix is ≤ 3 lines" and "a reasoning error, not
> a typo". Do not stack strawmen; a plain LLM should plausibly get several of these right.
>
> Each case carries a `run_result` object that must validate against
> `contracts/run_result.schema.json`. Read the schema and the fixture in `contracts/fixtures/`
> before writing the first case. The `failing_input` in each one must already be shrunk — a
> 40-element array in a fixture means you did not read `docs/handoffs.md`.
>
> Also add `services/brain/bench/validate_cases.py`: loads the jsonl, asserts twenty cases,
> asserts every required field is present, asserts each fix is ≤ 3 lines, and validates every
> `run_result` against the schema. Add a pytest that runs it. No network, no model calls —
> `run_bench.py` itself cannot run here because there is no `OPENAI_API_KEY`, and you should
> not try.
>
> Scope: `services/brain/bench/` plus one test file. Do not modify `run_bench.py` except to
> fix an outright bug, and call that out separately in the PR body if you do.

---

## 3 — Test coverage on the two things we never cut

> The shrinker and ladder redaction are the product. They have one test file each. Add cases.
>
> `services/proof-engine/tests/test_shrink.py` — read `app/shrink.py` and cover what the one
> existing test does not: an input that is already minimal, an input where nothing fails,
> non-list inputs, multiple arguments, and a predicate that is non-monotonic (shrinking stops
> somewhere sane rather than looping).
>
> `services/brain/tests/test_ladder.py` — read `app/ladder.py`. Redaction is the one that
> matters: assert that a locked rung carries no text under every input the model might
> actually return — fewer than five rungs, more than five, empty text, `unlocked=0`,
> `unlocked=4`, and an out-of-range `unlocked`. A locked rung leaking its text to the client
> is the single worst bug in this repo. Write the test that would catch it.
>
> Match the style of the tests already there: long descriptive names, a one-line docstring
> saying why the behaviour matters, few assertions per test.
>
> Do not change `shrink.py` or `ladder.py` to make a test pass. If a test you write fails
> against the real code, leave it failing, mark it `@pytest.mark.xfail` with a reason, and
> put the details at the top of the PR body. A real bug found overnight is worth more than a
> green checkmark.
>
> Scope: the two test files only.

---

## 4 — Make `make contracts` real

> The `contracts` target in the `Makefile` claims to validate every fixture against its
> schema. It does not — it only checks the JSON parses. Make it do what it says.
>
> Add `contracts/validate.py`: for each fixture in `contracts/fixtures/`, pick the schema it
> belongs to and validate it with `jsonschema`. Exit non-zero with a readable message naming
> the fixture, the failing field, and the expectation. Point the `Makefile` target at it.
>
> `jsonschema` is the one new dependency allowed here. No service declares it today, and no
> service declares `pytest` either — create `requirements-dev.txt` at the repo root holding
> both, and reference it from the `Makefile`.
>
> While you are in the `Makefile`: the `test` target calls `python`, which does not resolve on
> a stock macOS install. Change it to `python3`. That is in scope for this task and only this
> task.
>
> Do not edit any schema or any fixture. If a fixture fails validation once the check is
> real, that is the most valuable thing you will find tonight — leave it failing and lead
> the PR body with it.
>
> Scope: `Makefile`, `contracts/validate.py`, one requirements file.

---

## Morning review

In order, and stop when H+18 arrives regardless of what is left:

1. `git fetch && make test` on each branch before reading the diff. Red means closed.
2. Read the "what I did not touch" and "out of scope" lines first — that is where the real
   findings are.
3. Merge #1 and #4 first. They are the lowest risk and #1 is submission content.
4. Any xfail or failing-fixture finding gets triaged as a bug, not as a broken PR.
5. Fill `demo/blurbs/11-cognition.md` with the real numbers: sessions launched, PRs opened,
   PRs merged, hours the team was asleep. That file is the Cognition submission.
