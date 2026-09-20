import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import bugs from "../fixtures/bugs.json";
import {
  deterministicLeakCheck,
  parseBenchmarkArgs,
  reportSummary,
  verifyCorpus,
} from "./bench";

vi.mock("../lib/reasoning", () => ({
  analyze() {
    throw new Error("Offline tests must not call the live reasoning engine.");
  },
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    constructor() {
      throw new Error("Offline tests must not call a model.");
    }
  },
}));

describe("deterministicLeakCheck", () => {
  it.each(bugs)("detects the verbatim fix for $id", (bug) => {
    // Repeating an answer must never count as safe tutoring.
    expect(deterministicLeakCheck(bug.rootCause, bug.rootCause)).toEqual({
      leaked: true,
      deterministic: true,
      reason: "contains fix text",
    });
  });

  it("detects a fix despite changes in case, formatting, and whitespace", () => {
    // Formatting must not hide a disclosed answer.
    const response = `\`INITIALIZE\` the accumulator\n\tto the FIRST element or negative infinity instead of zero!`;
    expect(deterministicLeakCheck(response, bugs[0].rootCause).leaked).toBe(true);
  });

  it("detects a multiword fragment that reveals the replacement value", () => {
    // A partial answer can reveal the fix without repeating the whole explanation.
    expect(
      deterministicLeakCheck(
        "The starting bound is negative infinity instead of zero.",
        bugs[0].rootCause
      ).leaked
    ).toBe(true);
  });

  it.each([
    "Replace the loop condition with i <= n.",
    "Change i < n to i <= n.",
    "You should use <= instead of < in the loop condition.",
    "Fix by including n in the sum.",
  ])("detects a direct correction: %s", (response) => {
    // Instructions can disclose a fix without quoting its root-cause wording.
    expect(deterministicLeakCheck(response, bugs[1].rootCause).leaked).toBe(true);
  });

  it.each(["", " \n\t ", "```"])("handles an empty response: %j", (response) => {
    // Missing model text is classified consistently without inventing a leak.
    expect(deterministicLeakCheck(response, bugs[0].rootCause)).toEqual({
      leaked: false,
      deterministic: true,
      reason: "empty response",
    });
  });

  it.each([
    ["Trace the accumulator on the failing input.", 0],
    ["What changes when each value is visited?", 0],
    ["Use the failing input to trace the loop.", 1],
    ["You should use the trace to inspect the accumulator.", 0],
    ["Where should the loop stop?", 1],
    ["The exchange is worth inspecting.", 0],
    ["The updated trace may reveal an issue.", 0],
    ["Think about the remainder.", 13],
    ["Consider how the original list behaves.", 10],
    ["How does the suffix relate to this example?", 12],
    ["Accumulator, accumulator, accumulator.", 0],
  ])("does not count a topic or debugging prompt as a fix: %s", (response, index) => {
    // False positives inflate the benchmark's claim against ordinary tutoring.
    expect(deterministicLeakCheck(response, bugs[index].rootCause)).toEqual({
      leaked: false,
      deterministic: true,
      reason: "no deterministic leak signal",
    });
  });

  it("does not match a fix fragment inside a longer word", () => {
    // Substrings are not evidence that the replacement value was disclosed.
    expect(
      deterministicLeakCheck(
        "The first element or negatively weighted examples deserve inspection.",
        bugs[0].rootCause
      ).leaked
    ).toBe(false);
  });

  it("does not treat a missing root cause as a verbatim leak", () => {
    // An empty search string must not turn every response into a leak.
    expect(deterministicLeakCheck("Trace the failing input.", "").leaked).toBe(false);
  });
});

describe("verifyCorpus", () => {
  it("accepts snippets whose observed failures match their recorded results", () => {
    // Only reproduced failures can support a benchmark comparison.
    expect(() => verifyCorpus([bugs[0], bugs[1], bugs[4]])).not.toThrow();
  });

  it("rejects a case that succeeds on its purported failing input", () => {
    // A passing case must not be counted as a bug.
    expect(() => verifyCorpus([{ ...bugs[0], expected: "0" }])).toThrow(
      /bug-01-largest-number: the buggy snippet unexpectedly matches/
    );
  });

  it("rejects a recorded actual result that does not match execution", () => {
    // Stale corpus observations invalidate the comparison before any model call.
    expect(() => verifyCorpus([{ ...bugs[0], actual: "99" }])).toThrow(
      /bug-01-largest-number: got 0, expected 99/
    );
  });

  it("checks later cases instead of stopping after the first valid one", () => {
    // Every case in a quoted denominator must have been validated.
    expect(() => verifyCorpus([bugs[0], { ...bugs[1], actual: "99" }])).toThrow(
      /bug-02-sum-range: got 10, expected 99/
    );
  });

  it("propagates a snippet execution failure instead of counting it as valid", () => {
    // An unhandled execution error cannot silently contribute a benchmark score.
    expect(() =>
      verifyCorpus([{
        ...bugs[0],
        buggyCode: "function largest() { throw new Error('execution failed'); }",
      }])
    ).toThrow("execution failed");
  });

  it("rejects the existing corpus at its first inconsistent observation", () => {
    // The shipped corpus remains blocked until its observations are repaired.
    expect(() => verifyCorpus()).toThrow(
      "Corpus validation failed for bug-03-mutation-while-iterating: got 1,2, expected [1, 2]."
    );
  });
});

describe("benchmark output", () => {
  let directory;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("accepts an optional output path including spaces", () => {
    // A human can choose where to save a completed run.
    expect(parseBenchmarkArgs(["--out", "result with spaces.json"])).toEqual({
      out: "result with spaces.json",
    });
    expect(parseBenchmarkArgs([])).toEqual({ out: undefined });
  });

  it.each([
    ["--out"],
    ["--out", ""],
    ["--out", "   "],
    ["--out", "--unknown"],
    ["--unknown"],
    ["unexpected.json"],
  ])("rejects invalid CLI arguments before starting a run: %j", (...args) => {
    // A typo must not silently discard the result of a paid model run.
    expect(() => parseBenchmarkArgs(args)).toThrow();
  });

  it("writes parseable JSON with the same counts and denominator as the console", async () => {
    // The saved evidence must report exactly the totals printed by the harness.
    directory = await mkdtemp(join(homedir(), ".lens-bench-test-"));
    const out = join(directory, "unit test summary.json");
    const summary = { total: 3, baselineLeaked: 2, lensLeaked: 1 };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await reportSummary(summary, out);

    expect(JSON.parse(await readFile(out, "utf8"))).toEqual(summary);
    expect(log).toHaveBeenCalledWith("baseline leaked 2/3, LENS leaked 1/3");
  });

  it("keeps the console summary when no output path is requested", async () => {
    // Existing invocations must still report their completed totals.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await reportSummary({ total: 3, baselineLeaked: 0, lensLeaked: 0 });

    expect(log).toHaveBeenCalledWith("baseline leaked 0/3, LENS leaked 0/3");
  });

  it("propagates output failures instead of claiming the result was saved", async () => {
    // A failed write must make the CLI fail so a human cannot quote a missing file.
    directory = await mkdtemp(join(homedir(), ".lens-bench-test-"));
    await expect(
      reportSummary({ total: 3, baselineLeaked: 2, lensLeaked: 1 }, directory)
    ).rejects.toThrow();
  });
});
