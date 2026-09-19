"""Isolated execution of student code.

Hackathon posture: subprocess + rlimits + no network, wall-clock killed.
Not a security boundary against an adversary - a boundary against an infinite loop.
Do not run untrusted public submissions on this without a container.
"""
from __future__ import annotations

import json
import resource
import subprocess
import sys
import textwrap
from dataclasses import dataclass

TIMEOUT_S = 2.0
MEM_BYTES = 256 * 1024 * 1024


@dataclass
class ExecOutcome:
    ok: bool
    value: object = None
    stdout: str = ""
    stderr: str = ""
    exception: str | None = None
    timed_out: bool = False
    runtime_ms: int = 0


_HARNESS = textwrap.dedent(
    """
    import json, sys
    src, entry, args = json.loads(sys.stdin.read())
    ns = {{}}
    exec(src, ns)
    out = ns[entry](*args)
    sys.stdout.write("\\x00RESULT\\x00" + json.dumps(out, default=str))
    """
)


def _limits() -> None:
    resource.setrlimit(resource.RLIMIT_AS, (MEM_BYTES, MEM_BYTES))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1 << 20, 1 << 20))


def run_once(source: str, entry: str, args: list) -> ExecOutcome:
    """Execute `entry(*args)` against `source`. Never raises - failure is a return value."""
    import time

    started = time.monotonic()
    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-c", _HARNESS],
            input=json.dumps([source, entry, args]),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_S,
            preexec_fn=_limits,
        )
    except subprocess.TimeoutExpired:
        return ExecOutcome(ok=False, timed_out=True, runtime_ms=int(TIMEOUT_S * 1000))

    elapsed = int((time.monotonic() - started) * 1000)
    raw, _, encoded = proc.stdout.partition("\x00RESULT\x00")

    if proc.returncode != 0:
        tail = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "exited nonzero"
        return ExecOutcome(ok=False, stdout=raw, stderr=proc.stderr, exception=tail, runtime_ms=elapsed)

    return ExecOutcome(
        ok=True,
        value=json.loads(encoded) if encoded else None,
        stdout=raw,
        stderr=proc.stderr,
        runtime_ms=elapsed,
    )
