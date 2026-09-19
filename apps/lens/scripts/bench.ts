import OpenAI from "openai";
import { analyze } from "../lib/reasoning";
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

function evaluateBuggySnippet(bug: Bug): string {
  const input = parseInput(bug.failingInput);
  const fnName = extractFunctionName(bug.buggyCode);
  const runner = new Function(
    `${bug.buggyCode}; return ${fnName}(${JSON.stringify(input)});`
  );
  return String(runner());
}

function verifyCorpus(): void {
  for (const bug of BUGS) {
    const observed = evaluateBuggySnippet(bug);
    if (String(observed) === String(bug.expected)) {
      throw new Error(
        `Corpus validation failed for ${bug.id}: the buggy snippet unexpectedly matches the expected result.`
      );
    }
    if (String(observed) !== String(bug.actual)) {
      throw new Error(
        `Corpus validation failed for ${bug.id}: got ${observed}, expected ${bug.actual}.`
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

function deterministicLeakCheck(response: string, rootCause: string): LeakScore {
  const answer = normalizeText(response);
  const fixText = normalizeText(rootCause);
  const directPhrases = [
    "change",
    "replace",
    "should use",
    "use the",
    "set it to",
    "fix by",
    "update",
    "should be",
    "instead of",
    "not just",
    "return the actual",
  ];

  if (!answer) {
    return { leaked: false, deterministic: true, reason: "empty response" };
  }

  if (answer.includes(fixText)) {
    return { leaked: true, deterministic: true, reason: "contains fix text" };
  }

  for (const phrase of directPhrases) {
    if (answer.includes(phrase)) {
      return { leaked: true, deterministic: true, reason: `contains direct instruction: ${phrase}` };
    }
  }

  const fragments = rootCause
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 8);
  for (const fragment of fragments) {
    if (normalizeText(fragment) && answer.includes(normalizeText(fragment))) {
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

async function benchmark(): Promise<void> {
  verifyCorpus();

  let baselineLeaked = 0;
  let lensLeaked = 0;

  for (const bug of BUGS) {
    const baselineText = await baselineResponse(bug);
    const baselineScore = deterministicLeakCheck(baselineText, bug.rootCause);
    const llmBaseline = await llmLeakJudge(baselineText, bug);

    const lensText = await analyze({
      problem: bug.problem,
      code: bug.buggyCode,
      run: {
        passed: false,
        failingInput: bug.failingInput,
        expected: bug.expected,
        actual: bug.actual,
        shrinkSteps: 1,
      },
      history: [
        `run:${bug.failingInput}`,
        `sandbox: expected ${bug.expected}, got ${bug.actual}`,
      ],
      priorAttempts: 0,
    });

    const lensResponse = `${lensText.hint}\n${lensText.step}\n${lensText.probableBelief}`;
    const lensScore = deterministicLeakCheck(lensResponse, bug.rootCause);
    const llmLens = await llmLeakJudge(lensResponse, bug);

    if (baselineScore.leaked) baselineLeaked += 1;
    if (lensScore.leaked) lensLeaked += 1;

    console.log(
      `${bug.id}: baseline=${baselineScore.leaked ? "leak" : "safe"} (${baselineScore.reason}); lens=${lensScore.leaked ? "leak" : "safe"} (${lensScore.reason}); llmBaseline=${llmBaseline}; llmLens=${llmLens}`
    );
  }

  console.log(`baseline leaked ${baselineLeaked}/${BUGS.length}, LENS leaked ${lensLeaked}/${BUGS.length}`);
}

benchmark().catch((error) => {
  console.error(error);
  process.exit(1);
});
