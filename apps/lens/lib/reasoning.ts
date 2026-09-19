import OpenAI from "openai";
import type { Divergence, RunResult } from "./types";

export const REASONING_STATES = "reasoning_states";

const SYSTEM_PROMPT = `You are LENS, a tutor that never gives the answer.

You are given a coding task, the student's code, the smallest failing input, and the real execution result from the sandbox. Your job is to infer where the student's reasoning diverged without ever naming the fix.

Core rule: never decide correctness and never reveal the answer. The sandbox owns truth. You own language only.

Your output must be a single JSON object matching this schema:
- step: the exact line or step where the reasoning broke
- probableBelief: what the student likely believes, in plain words
- confidence: number from 0 to 1
- rung: 1 to 5
- hint: a short, non-punitive hint for the student
- question: optional question to ask the student
- options: optional multiple choice list
- citation: optional object with text and source
- shouldRevealAnswer: always false

Hard constraints:
- Never name the corrected operator, value, initial value, or line.
- Never output code, even as an example.
- Never write the corrected solution or direct the student to copy a change.
- Never say 'you should have', 'obviously', or 'simply'.
- Address the belief, not the person.
- If the failing input is ambiguous about the cause, lower confidence and choose rung 1.
- Start at the lowest rung the evidence supports.
- Escalate exactly one rung per prior failed attempt. Never skip rungs.
- If the student has already failed a number of hints, respect the priorAttempts count as the rung ceiling.
- Do not mention the reference solution or correct code. The model must never see the answer.

Hint ladder:
1. Point at the step. Name where to look, nothing more.
2. Ask a question about what the student expects at that step.
3. Conceptual nudge about the underlying idea, no specifics of this code.
4. Propose one small experiment: change exactly one thing, predict, run.
5. Explain the concept. Still never writes the corrected line.

When choosing the rung:
- Rung 1: point at the precise place to inspect, where the code or reasoning likely diverges.
- Rung 2: ask what the student expects at that step.
- Rung 3: give a conceptual idea without naming the actual fix.
- Rung 4: suggest one controlled test or small experiment about exactly one variable.
- Rung 5: explain the concept in plain language while still avoiding the corrected line.

Output policy:
- Keep the hint brief and actionable.
- Prefer a question format when the student can answer from the code they wrote.
- Keep the citation grounded in the exact student code or failing input when available.
- Use a low confidence when the evidence is weak.
- The final object must have additionalProperties: false and shouldRevealAnswer strictly equal to false.`;

const divergenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    step: { type: "string" },
    probableBelief: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rung: { type: "integer", enum: [1, 2, 3, 4, 5] },
    hint: { type: "string" },
    question: { type: "string" },
    options: {
      type: "array",
      items: { type: "string" },
    },
    citation: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string" },
        source: { type: "string" },
      },
      required: ["text", "source"],
    },
    shouldRevealAnswer: { enum: [false] },
  },
  required: [
    "step",
    "probableBelief",
    "confidence",
    "rung",
    "hint",
    "shouldRevealAnswer",
  ],
} as const;

export async function analyze(input: {
  problem: string;
  code: string;
  run: RunResult;
  history: string[];
  priorAttempts: number;
}): Promise<Divergence> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const cappedRung = Math.min(Math.max(input.priorAttempts, 0) + 1, 5);
  const userPayload = {
    problem: input.problem,
    code: input.code,
    failingInput: input.run.failingInput,
    expected: input.run.expected,
    actual: input.run.actual,
    history: input.history.slice(-20),
    priorAttempts: input.priorAttempts,
    rungCap: cappedRung,
  };

  const completion = await client.chat.completions.create({
    model: "gpt-4o-2024-08-06",
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload, null, 2) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "divergence",
        strict: true,
        schema: divergenceSchema,
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned no content");
  }

  const parsed = JSON.parse(content) as Partial<Divergence>;

  if (parsed.shouldRevealAnswer !== false) {
    throw new Error("Model attempted to reveal the answer");
  }

  const divergence: Divergence = {
    step: String(parsed.step ?? ""),
    probableBelief: String(parsed.probableBelief ?? ""),
    confidence: Number(parsed.confidence ?? 0),
    rung: Number(parsed.rung ?? 1) as Divergence["rung"],
    hint: String(parsed.hint ?? ""),
    question: parsed.question ? String(parsed.question) : undefined,
    options: parsed.options ? parsed.options.map(String) : undefined,
    citation: parsed.citation
      ? {
          text: String(parsed.citation.text),
          source: String(parsed.citation.source),
        }
      : undefined,
    shouldRevealAnswer: false,
  };

  if (divergence.rung > cappedRung) {
    divergence.rung = cappedRung as Divergence["rung"];
  }

  divergence.confidence = Math.min(1, Math.max(0, divergence.confidence));

  return divergence;
}

export async function analyzeReasoning(
  _input?: {
    sessionId?: string;
    userId?: string;
    objective?: string;
    latestObservation?: string | null;
    useSources?: boolean;
  }
): Promise<any> {
  throw new Error(
    "Legacy reasoning API is unavailable in this LENS slice; use analyze() from lib/reasoning.ts instead."
  );
}

export async function latestReasoningState(_sessionId?: string): Promise<any | null> {
  throw new Error(
    "Legacy reasoning API is unavailable in this LENS slice; use analyze() from lib/reasoning.ts instead."
  );
}

export async function reasoningTimeline(
  _sessionId?: string,
  _limit?: number
): Promise<any[]> {
  throw new Error(
    "Legacy reasoning API is unavailable in this LENS slice; use analyze() from lib/reasoning.ts instead."
  );
}
