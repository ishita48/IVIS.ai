import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ObjectId } from "mongodb";
import OpenAI from "openai";
import { recordEvent } from "../lib/events";
import { analyzeReasoning } from "../lib/reasoning";
import bugsData from "../fixtures/bugs.json";

type Bug = {
  id: string;
  problem: string;
  buggyCode: string;
  failingInput: string;
  expected: string;
  actual: string;
  rootCause: string;
};

type LeakScore = {
  leaked: boolean;
  deterministic: boolean;
  reason: string;
};

const BUGS = bugsData as Bug[];

function parseInput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return new Function(`return (${raw});`)();
  }
}

function extractFunctionName(code: string): string {
  const match = code.match(/function\s+([A-Za-z0-9_]+)/);
  return match ? match[1] : "solution";
}

function declaredArity(code: string): number {
  const match = code.match(/function\s+[A-Za-z0-9_]*\s*\(([^)]*)\)/);
  if (!match) return 1;
  return match[1].split(",").filter((param) => param.trim()).length;
}

/** A multi-parameter function takes its failing input as an argument list. */
function argumentList(bug: Bug): unknown[] {
  const input = parseInput(bug.failingInput);
  if (declaredArity(bug.buggyCode) > 1 && Array.isArray(input)) return input;
  return [input];
}

function canonicalValue(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return JSON.stringify(value) ?? String(value);
}

function canonicalResult(raw: string): string {
  try {
    return canonicalValue(JSON.parse(raw));
  } catch {
    return raw.trim();
  }
}

function evaluateBuggySnippet(bug: Bug): string {
  const fnName = extractFunctionName(bug.buggyCode);
  const args = argumentList(bug).map((arg) => JSON.stringify(arg));
  const runner = new Function(`${bug.buggyCode}; return ${fnName}(${args.join(", ")});`);
  try {
    return canonicalValue(runner());
  } catch (error) {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    throw error;
  }
}

export function verifyCorpus(bugs: readonly Bug[] = BUGS): void {
  for (const bug of bugs) {
    const observed = evaluateBuggySnippet(bug);
    const expected = canonicalResult(bug.expected);
    const actual = canonicalResult(bug.actual);
    if (observed === expected) {
      throw new Error(
        `Corpus validation failed for ${bug.id}: the buggy snippet unexpectedly matches the expected result.`
      );
    }
    if (observed !== actual) {
      throw new Error(
        `Corpus validation failed for ${bug.id}: got ${observed}, expected ${actual}.`
      );
    }
  }
}

function normalizeText(value: string): string {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[`\n\r\t'"\[\]{}()!?,.;:+=<>/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function deterministicLeakCheck(response: string, rootCause: string): LeakScore {
  const answer = normalizeText(response);
  const fixText = normalizeText(rootCause);
  const containsPhrase = (phrase: string) => ` ${answer} `.includes(` ${phrase} `);
  const directInstructions = [
    /\breplace\s+[^.!?\n]+?\s+with\s+\S+/i,
    /\b(?:change|update|set)\s+[^.!?\n]+?\s+to\s+\S+/i,
    /\buse\s+[^.!?\n]+?\s+(?:instead of|rather than)\s+\S+/i,
    /\bfix\s+(?:it\s+)?by\s+\S+/i,
  ];

  if (!answer) {
    return { leaked: false, deterministic: true, reason: "empty response" };
  }

  if (fixText && containsPhrase(fixText)) {
    return { leaked: true, deterministic: true, reason: "contains fix text" };
  }

  for (const instruction of directInstructions) {
    const match = response.match(instruction);
    if (match) {
      return { leaked: true, deterministic: true, reason: `contains direct instruction: ${match[0]}` };
    }
  }

  const words = fixText.split(" ");
  const fragmentLength = 5;
  for (let index = 0; index <= words.length - fragmentLength; index += 1) {
    const fragment = words.slice(index, index + fragmentLength).join(" ");
    if (containsPhrase(fragment)) {
      return { leaked: true, deterministic: true, reason: `contains fix fragment: ${fragment}` };
    }
  }

  return { leaked: false, deterministic: true, reason: "no deterministic leak signal" };
}

async function llmLeakJudge(response: string, bug: Bug): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return "skipped: OPENAI_API_KEY not set";
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = [
    "Judge whether the following answer reveals the fix to the bug.",
    "Answer with one word only: LEAK or SAFE.",
    "A leak includes the corrected line, the correct operator or value in context, or a direct instruction naming the change.",
    "",
    `Problem: ${bug.problem}`,
    `Root cause: ${bug.rootCause}`,
    `Response: ${response}`,
  ].join("\n");

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });

  return completion.choices[0]?.message?.content ?? "unknown";
}

async function baselineResponse(bug: Bug): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to run the benchmark.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const user = [
    "here is my code and the error, help me fix it",
    `Problem: ${bug.problem}`,
    `Code:\n${bug.buggyCode}`,
    `Failing input: ${bug.failingInput}`,
    `Expected: ${bug.expected}`,
    `Actual: ${bug.actual}`,
  ].join("\n");

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: user }],
    temperature: 0.2,
  });

  return completion.choices[0]?.message?.content ?? "";
}

export function parseBenchmarkArgs(args: string[]): { out?: string } {
  const { values } = parseArgs({
    args,
    options: { out: { type: "string" } },
    allowPositionals: false,
    strict: true,
  });
  if (values.out !== undefined && !values.out.trim()) {
    throw new Error("--out requires a non-empty path.");
  }
  return { out: values.out };
}

type BenchmarkSummary = {
  total: number;
  baselineLeaked: number;
  lensLeaked: number;
};

export async function reportSummary(
  summary: BenchmarkSummary,
  out?: string
): Promise<void> {
  if (out !== undefined) {
    await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(
    `baseline leaked ${summary.baselineLeaked}/${summary.total}, LENS leaked ${summary.lensLeaked}/${summary.total}`
  );
}

const BENCH_USER_ID = "bench";

/**
 * The engine reads its evidence from the session event log, so each case
 * gets a fresh session with the two real events a student produces when a
 * run fails: a prediction of the result, then a retry after the sandbox
 * disagrees. Two attempts cap the ladder at NUDGE.
 */
async function lensResponseFor(bug: Bug): Promise<string> {
  const sessionId = new ObjectId().toHexString();
  const fnName = extractFunctionName(bug.buggyCode);
  const call = `${fnName}(${bug.failingInput})`;

  await recordEvent({
    sessionId,
    userId: BENCH_USER_ID,
    type: "prediction",
    payload: { question: `What does ${call} return?`, answer: bug.expected },
  });
  await recordEvent({
    sessionId,
    userId: BENCH_USER_ID,
    type: "retry",
    payload: { reason: `the sandbox returned ${bug.actual} for ${call}, not ${bug.expected}` },
  });

  const state = await analyzeReasoning({
    sessionId,
    userId: BENCH_USER_ID,
    objective: `${bug.problem}\n\nStudent code:\n${bug.buggyCode}`,
    latestObservation: `Sandbox ran ${call}: expected ${bug.expected}, got ${bug.actual}.`,
    useSources: false,
  });

  return [state.intervention, state.probableBelief, state.misconception]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

async function benchmark(out?: string): Promise<void> {
  verifyCorpus();

  let baselineLeaked = 0;
  let lensLeaked = 0;

  for (const bug of BUGS) {
    const baselineText = await baselineResponse(bug);
    const baselineScore = deterministicLeakCheck(baselineText, bug.rootCause);
    const llmBaseline = await llmLeakJudge(baselineText, bug);

    const lensResponse = await lensResponseFor(bug);
    const lensScore = deterministicLeakCheck(lensResponse, bug.rootCause);
    const llmLens = await llmLeakJudge(lensResponse, bug);

    if (baselineScore.leaked) baselineLeaked += 1;
    if (lensScore.leaked) lensLeaked += 1;

    console.log(
      `${bug.id}: baseline=${baselineScore.leaked ? "leak" : "safe"} (${baselineScore.reason}); lens=${lensScore.leaked ? "leak" : "safe"} (${lensScore.reason}); llmBaseline=${llmBaseline}; llmLens=${llmLens}`
    );
  }

  await reportSummary({ total: BUGS.length, baselineLeaked, lensLeaked }, out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { out } = parseBenchmarkArgs(process.argv.slice(2));
  benchmark(out).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
