/**
 * LENS Proof — real code execution (P1).
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 3 (Pointer & Proof). Build this ONLY after the P0 camera
 * loop is bulletproof.
 *
 * The point of this tier: when a student's work can be run, LENS does not
 * ask a model whether the code is wrong — it runs the code and finds the
 * smallest input that actually fails. The model's job is to explain the
 * divergence, not to decide there is one. That distinction is the whole
 * difference between "AI says your code is wrong" and proof.
 *
 * Piston (emkc.org) needs no auth and covers 60+ languages. It is rate
 * limited, so if it 429s during the hack, swap RUNNER_URL for a local
 * Piston container — same request shape, different host.
 */

const RUNNER_URL =
  process.env.PISTON_URL || "https://emkc.org/api/v2/piston/execute";

export type RunResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
};

const LANGUAGE_VERSIONS: Record<string, string> = {
  python: "3.10.0",
  javascript: "18.15.0",
  typescript: "5.0.3",
  java: "15.0.2",
  c: "10.2.0",
  "c++": "10.2.0",
  go: "1.16.2",
  rust: "1.68.2",
};

export async function runCode(opts: {
  language: string;
  source: string;
  stdin?: string;
  args?: string[];
}): Promise<RunResult> {
  const language = opts.language.toLowerCase();
  const res = await fetch(RUNNER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      language,
      version: LANGUAGE_VERSIONS[language] || "*",
      files: [{ content: opts.source }],
      stdin: opts.stdin ?? "",
      args: opts.args ?? [],
      compile_timeout: 10_000,
      run_timeout: 5_000,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Sandbox failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as any;
  const run = json.run ?? {};
  const compile = json.compile ?? {};

  return {
    stdout: String(run.stdout ?? ""),
    stderr: String(compile.stderr || run.stderr || ""),
    code: run.code ?? null,
    timedOut: run.signal === "SIGKILL",
  };
}

/**
 * Finds the SMALLEST input on which the student's program and a known-good
 * reference disagree. Real execution on both sides, real string comparison —
 * no model is asked to guess which input breaks it.
 *
 * `candidates` should be ordered simplest-first; the first disagreement is
 * by construction the smallest failing case the student has to think about.
 */
export async function shrinkToFailingCase(opts: {
  language: string;
  studentSource: string;
  referenceSource: string;
  candidates: string[];
}): Promise<{
  failingInput: string;
  expected: string;
  actual: string;
  checked: number;
} | null> {
  let checked = 0;
  for (const stdin of opts.candidates) {
    checked++;
    const [student, reference] = await Promise.all([
      runCode({ language: opts.language, source: opts.studentSource, stdin }),
      runCode({ language: opts.language, source: opts.referenceSource, stdin }),
    ]);

    const actual = student.stdout.trim();
    const expected = reference.stdout.trim();
    if (actual !== expected) {
      return { failingInput: stdin, expected, actual, checked };
    }
  }
  return null;
}
