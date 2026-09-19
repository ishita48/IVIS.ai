"""Mine CodeNet for real student bug patterns.

CodeNet ships accepted and rejected submissions for the same problem by the same user.
A (rejected -> accepted) pair from one user IS a real bug and its real fix. That is the
seed corpus for the 20-bug benchmark - not bugs we invented to make LENS look good.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path


def mine(codenet_root: Path, language: str = "Python", limit: int = 500) -> list[dict]:
    """Yield {problem_id, user_id, buggy, fixed} pairs."""
    pairs: list[dict] = []
    meta_dir = codenet_root / "metadata"

    for problem_csv in sorted(meta_dir.glob("p*.csv"))[:limit]:
        by_user: dict[str, dict[str, list]] = defaultdict(lambda: {"WA": [], "AC": []})
        for line in problem_csv.read_text().splitlines()[1:]:
            cols = line.split(",")
            sub_id, _, _, user_id, lang, _, status = cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6]
            if lang != language or status not in ("Wrong Answer", "Accepted"):
                continue
            by_user[user_id]["WA" if status == "Wrong Answer" else "AC"].append(sub_id)

        pid = problem_csv.stem
        for user_id, subs in by_user.items():
            if subs["WA"] and subs["AC"]:
                pairs.append({
                    "problem_id": pid,
                    "user_id": user_id,
                    "buggy_id": subs["WA"][-1],   # last failure before success
                    "fixed_id": subs["AC"][0],
                })
    return pairs


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, required=True, help="Project_CodeNet directory")
    ap.add_argument("--out", type=Path, default=Path("bench/bugs/mined.jsonl"))
    args = ap.parse_args()

    found = mine(args.root)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(json.dumps(p) for p in found))
    print(f"{len(found)} bug pairs -> {args.out}")
