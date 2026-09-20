/**
 * LENS Code — the Proof tier, finally wired to a screen.
 * ─────────────────────────────────────────────────────────────────────
 *
 * lib/sandbox.ts has run real code against real inputs since early on, and
 * nothing in the UI ever called it. This is the layer between that and the
 * editor tab.
 *
 * THE RULE THAT SHAPES THIS FILE: the checker decides, the model explains.
 * Whether the student's code is wrong is never a model's opinion — the code
 * runs, the output is compared to a known expected value, and that is the
 * verdict. A model is only ever asked to describe *why* the two diverged,
 * and only after a real divergence exists.
 *
 * `rootCause` NEVER LEAVES THE SERVER. Every fixture carries the one-line
 * explanation of the bug, which is precisely the answer LENS exists not to
 * give. It is stripped from anything sent to the browser and used only as
 * private context for hint generation, where the ladder caps how much of
 * it can surface. Shipping it to the client and hiding it in CSS would
 * make the whole product a lie — see ENGINEERING.md rule 3.
 */

import bugs from "@/fixtures/bugs.json";
import { parseInput, runJavaScript } from "./runner";

export type BugFixture = {
  id: string;
  problem: string;
  buggyCode: string;
  failingInput: string;
  expected: string;
  actual: string;
  /** Server-only. The answer. */
  rootCause: string;
};

/** What the browser is allowed to know about a problem. */
export type CodingProblem = {
  id: string;
  problem: string;
  starterCode: string;
  language: "javascript";
  /** Shown only after a failing run, as evidence — never as a hint. */
  knownFailingInput: string;
};

/**
 * Imported rather than read from disk at request time.
 *
 * `readFile(path.join(process.cwd(), ...))` made Turbopack report "dynamic
 * filesystem access causes tracing of the whole project" — it cannot see
 * which file is meant, so it ships everything to be safe, and if it ever
 * guessed the other way the route would 500 in production only. A static
 * import is resolved at build time: the fixture is in the bundle, the
 * whole-project trace goes away, and the failure mode moves to compile
 * time where it belongs.
 */
const FIXTURES = bugs as BugFixture[];

export function listProblems(): CodingProblem[] {
  return FIXTURES.map(toProblem);
}

export function getFixture(id: string): BugFixture | null {
  return FIXTURES.find((r) => r.id === id) ?? null;
}

function toProblem(f: BugFixture): CodingProblem {
  return {
    id: f.id,
    problem: f.problem,
    starterCode: f.buggyCode,
    language: "javascript",
    knownFailingInput: f.failingInput,
  };
}

/**
 * Wrap the student's function so it gets called with the fixture's input
 * and prints its result.
 *
 * The fixtures are bare functions with no I/O. Generating the harness here
 * rather than making the student write it keeps the editor about the bug
 * rather than about plumbing — and keeps the comparison honest, because
 * every submission is invoked in exactly the same way.
 *
 * The input arrives as the global `__lensInput`, injected into the vm
 * context by lib/runner.ts as a real value. It used to come in over stdin,
 * back when this shelled out to Piston; there is no stdin to read now, and
 * skipping the round trip through text also means an input like `["ab",
 * "ab"]` cannot be re-parsed into something subtly different on the way in.
 *
 * A multi-argument function is spread from an array input, matching how
 * the fixtures write their failing cases.
 */
export function buildHarness(source: string): string {
  const name = source.match(/function\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (!name) {
    throw new Error(
      "Could not find a named function to run. Keep the `function name(...)` declaration."
    );
  }

  // JSON.stringify the result so arrays and objects compare as text the
  // same way the fixture's `expected` is written.
  //
  // The call is wrapped in a block so `__out` cannot collide with anything
  // the student declared at the top level.
  return `${source}

{
  const __out = Array.isArray(__lensInput) && ${name}.length > 1
    ? ${name}(...__lensInput)
    : ${name}(__lensInput);

  console.log("${ANSWER_MARKER}" + (typeof __out === "string" ? __out : JSON.stringify(__out)));
}
`;
}

/**
 * Prefix that separates the harness's answer from anything the student
 * logged themselves.
 *
 * Students print things while debugging — that is the correct instinct and
 * the editor should not punish it by failing a run that was right. Piston
 * compared whole stdout and so quietly counted a stray console.log as a
 * wrong answer. Marking the one line that is the answer fixes that, and
 * the student's own output is still shown to them next to the verdict.
 */
const ANSWER_MARKER = "\u0000LENS\u0000";

/** Split a run's stdout into the harness's answer and the student's logs. */
export function splitOutput(stdout: string): { answer: string; logs: string } {
  const lines = stdout.split("\n");
  const answerIdx = lines.findIndex((l) => l.startsWith(ANSWER_MARKER));
  if (answerIdx === -1) return { answer: "", logs: stdout.trim() };
  return {
    answer: lines[answerIdx].slice(ANSWER_MARKER.length).trim(),
    logs: lines
      .filter((_, i) => i !== answerIdx)
      .join("\n")
      .trim(),
  };
}

/** Compare the way the fixtures are written: trimmed text, JSON-normalised. */
export function sameAnswer(a: string, b: string): boolean {
  const norm = (s: string) => {
    const t = s.trim();
    try {
      return JSON.stringify(JSON.parse(t));
    } catch {
      return t;
    }
  };
  return norm(a) === norm(b);
}

export type CheckResult = {
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  /** Anything the student printed themselves, kept out of the comparison. */
  logs: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
};

/**
 * Run the student's code against the fixture's known failing input.
 *
 * This is the checker. It returns a verdict and nothing resembling advice;
 * the hint is a separate, later call that only happens once this has
 * already found a real divergence.
 */
export async function checkAgainstFixture(
  fixture: BugFixture,
  source: string
): Promise<CheckResult> {
  const startedAt = Date.now();
  const result = await runJavaScript({
    source: buildHarness(source),
    input: parseInput(fixture.failingInput),
  });

  const { answer, logs } = splitOutput(result.stdout);

  return {
    passed: !result.stderr && sameAnswer(answer, fixture.expected),
    input: fixture.failingInput,
    expected: fixture.expected,
    actual: result.stderr ? "" : answer,
    logs: logs.slice(0, 1200),
    stderr: result.stderr.trim().slice(0, 600),
    timedOut: result.timedOut,
    ms: Date.now() - startedAt,
  };
}
