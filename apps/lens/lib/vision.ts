/**
 * LENS Vision — real multimodal analysis of a captured frame.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 2 (Vision & Reasoning).
 *
 * Why OpenAI here and not lib/llm.ts: this call needs *enforced* JSON, not
 * "please respond in JSON". `response_format: { type: "json_schema",
 * strict: true }` is validated by the API itself — a malformed response is
 * an API-level failure, not a frontend parse bug at 3am. Gemma on the
 * Gemini API does not accept a response schema (see lib/llm.ts), which is
 * exactly why the reasoning path uses llm.ts and this one does not.
 *
 * Every call here runs against a frame captured seconds ago. There is no
 * cached observation and no fixture in this module. The upload path in
 * /api/vision/analyze is the SAME function with a different input source —
 * that is the Section 19 network fallback, not a second code path.
 */

import OpenAI from "openai";
import type { VisionObservation } from "./lens/contracts";

const VISION_MODEL = process.env.OPENAI_MODEL_VISION || "gpt-4o";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set — LENS Vision cannot run. Add it to .env.local."
    );
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

/**
 * JSON Schema handed to the API. `strict: true` means every key below is
 * required and `additionalProperties` is rejected — nullable fields are
 * expressed as a union type rather than omitted, per OpenAI's spec.
 */
const OBSERVATION_SCHEMA = {
  name: "lens_observation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "observation",
      "objects",
      "boundingBox",
      "confidence",
      "possibleIssue",
      "suggestedQuestion",
      "suggestedOptions",
      "shouldRevealAnswer",
    ],
    properties: {
      observation: {
        type: "string",
        description:
          "One sentence describing what is actually visible. Describe, do not diagnose.",
      },
      objects: {
        type: "array",
        items: { type: "string" },
        description: "Objects visible in the frame, most relevant first.",
      },
      boundingBox: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "width", "height"],
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
          },
          { type: "null" },
        ],
        description:
          "Normalized 0-1 box (origin top-left) around the ONE thing that matters. Null if nothing specific.",
      },
      confidence: { type: "number" },
      possibleIssue: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "snake_case concept slug, e.g. led_polarity. Null if none.",
      },
      suggestedQuestion: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "A question that makes the student reason. Never the answer.",
      },
      suggestedOptions: {
        type: "array",
        items: { type: "string" },
        description: "2-4 short answer options for suggestedQuestion.",
      },
      shouldRevealAnswer: { type: "boolean" },
    },
  },
} as const;

const VISION_SYSTEM = `You are the eyes of LENS, a tutor that never gives the answer.

You are shown a single frame of a student's real workspace — a circuit on a breadboard, a notebook, a lab setup, a screen. Your job is to observe, not to solve.

Rules, in priority order:
1. Describe only what you can actually see. If the frame is blurry, dark, or ambiguous, say so in "observation" and return a low confidence. Never invent a component, a value, or a wire that you cannot see.
2. Point at exactly ONE thing — the single element most worth the student's attention right now. That is the boundingBox. If nothing stands out, return null rather than a box around the whole frame.
3. Ask, do not tell. "suggestedQuestion" must be answerable by the student from what is in front of them, and must not contain the answer. "Which leg of the LED do you think connects to positive?" is right. "The LED is backwards, flip it" is wrong.
4. shouldRevealAnswer must be false. LENS escalates help; it does not dump solutions.
5. possibleIssue is a short snake_case slug naming the likely misconception, or null. It is a hypothesis, not a verdict.`;

export type AnalyzeFrameInput = {
  /** Raw base64 (no data: prefix) or a full data URL. */
  imageBase64: string;
  /** What the student is trying to do. Shapes what counts as "matters". */
  objective?: string;
  /**
   * The previous observation, when this is a VERIFY pass. Lets the model
   * compare against what it saw before instead of starting cold.
   */
  previousObservation?: string | null;
  mediaType?: "image/jpeg" | "image/png" | "image/webp";
};

export type AnalyzeFrameResult = {
  observation: VisionObservation;
  latencyMs: number;
  model: string;
};

/** Strips a `data:image/jpeg;base64,` prefix if the caller left one on. */
export function stripDataUrl(input: string): {
  data: string;
  mediaType: string | null;
} {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(input.trim());
  if (match) return { data: match[2], mediaType: match[1] };
  return { data: input.trim(), mediaType: null };
}

export async function analyzeFrame(
  input: AnalyzeFrameInput
): Promise<AnalyzeFrameResult> {
  const { data, mediaType } = stripDataUrl(input.imageBase64);
  if (!data) throw new Error("No image data supplied to analyzeFrame");

  const mime = input.mediaType || mediaType || "image/jpeg";
  const startedAt = Date.now();

  const userText = [
    input.objective
      ? `The student's stated objective: ${input.objective}`
      : `The student has not stated an objective. Infer it from the frame.`,
    input.previousObservation
      ? `You previously observed: "${input.previousObservation}". This is a NEW frame taken after the student acted. State plainly whether what you flagged has changed.`
      : null,
    `Analyze the frame and respond with the schema.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await client().chat.completions.create({
    model: VISION_MODEL,
    // Low temperature: this is perception, not creative writing.
    temperature: 0.2,
    max_tokens: 700,
    response_format: { type: "json_schema", json_schema: OBSERVATION_SCHEMA as any },
    messages: [
      { role: "system", content: VISION_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${data}`, detail: "high" },
          },
        ] as any,
      },
    ],
  });

  const raw = res.choices[0]?.message?.content;
  if (!raw) throw new Error("Vision returned an empty response");

  // Schema is enforced server-side, so this parse is a formality — but a
  // refusal (safety stop) comes back as valid JSON-less content, so we
  // still fail loudly rather than shipping undefined to the UI.
  const parsed = JSON.parse(raw) as VisionObservation;

  return {
    observation: normalizeObservation(parsed),
    latencyMs: Date.now() - startedAt,
    model: VISION_MODEL,
  };
}

/** Clamps box coordinates and confidence into the ranges the UI assumes. */
function normalizeObservation(o: VisionObservation): VisionObservation {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, Number(n) || 0));
  const box = o.boundingBox
    ? {
        x: clamp01(o.boundingBox.x),
        y: clamp01(o.boundingBox.y),
        width: clamp01(o.boundingBox.width),
        height: clamp01(o.boundingBox.height),
      }
    : null;

  return {
    ...o,
    boundingBox: box && box.width > 0.001 && box.height > 0.001 ? box : null,
    confidence: clamp01(o.confidence),
    objects: Array.isArray(o.objects) ? o.objects.slice(0, 8) : [],
    suggestedOptions: Array.isArray(o.suggestedOptions)
      ? o.suggestedOptions.slice(0, 4)
      : [],
    // Hard product rule enforced in code, not just in the prompt.
    shouldRevealAnswer: false,
  };
}

export function visionConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
