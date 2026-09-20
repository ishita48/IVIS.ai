/**
 * LENS Proof - real code execution.
 * -------------------------------------------------------------------
 *
 * The point of this tier: when a student's work can be run, LENS does not
 * ask a model whether the code is wrong - it runs the code and finds the
 * smallest input that actually fails. The model's job is to explain the
 * divergence, not to decide there is one. That distinction is the whole
 * difference between "AI says your code is wrong" and proof.
 *
 * EXECUTION MOVED IN-PROCESS. This used to post every run to the public
 * Piston instance at emkc.org. That endpoint became whitelist-only on
 * 2026-02-15 and now answers every request with:
 *
 *   401 {"message":"Public Piston API is now whitelist only as of
 *   2/15/2026. Please host your own instance..."}
 *
 * Hosting an instance means running Docker, which a Vercel deployment
 * does not do. So JavaScript - the language every fixture in
 * fixtures/bugs.json is written in - now runs locally through
 * lib/runner.ts, in a worker thread with a vm context and a timeout.
 *
 * Other languages still route to Piston, and will keep failing against
 * the public host. That is left in place rather than deleted because the
 * request shape is still correct: point PISTON_URL at a self-hosted
 * instance and Python, Java and the rest work again with no code change.
 * The error below names that explicitly instead of surfacing a bare 401,
 * because "you need your own Piston" is not something a stack trace says.
 */

import { parseInput, runJavaScript } from "./runner";

const PUBLIC_PISTON = "https://emkc.org/api/v2/piston/execute";

/** Set PISTON_URL to a self-hosted instance to re-enable other languages. */
const RUNNER_URL = process.env.PISTON_URL || PUBLIC_PISTON;

/** True when we'd be posting to the host that no longer accepts us. */
const PISTON_IS_DEAD = RUNNER_URL === PUBLIC_PISTON;

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

  // The local path. No network, ~45ms, and it cannot be rate limited or
  // switched off by someone else's policy change.
  if (language === "javascript" || language === "js") {
    // `stdin` carries the program's input here, the same way it did when
    // this posted to Piston. The local runner has no stdin, so it is parsed
    // and injected as the global `__lensInput` instead - shrinkToFailingCase
    // varies exactly this value, and dropping it would make every candidate
    // produce identical output and find no failing case at all.
    const r = await runJavaScript({
      source: opts.source,
      input: parseInput(opts.stdin ?? ""),
      timeoutMs: 5_000,
    });
    return { stdout: r.stdout, stderr: r.stderr, code: r.stderr ? 1 : 0, timedOut: r.timedOut };
  }

  if (PISTON_IS_DEAD) {
    throw new Error(
      `Running ${language} needs a code sandbox. The public Piston API became ` +
        `whitelist-only on 2026-02-15, so set PISTON_URL to a self-hosted ` +
        `instance to enable it. JavaScript runs locally and is unaffected.`
    );
  }

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
