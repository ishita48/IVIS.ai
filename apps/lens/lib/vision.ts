/**
 * LENS Vision — the eye, not the teacher.
 *
 * This module answers exactly one question: "what is in front of the camera
 * right now, and where is the one thing worth attention?" It does not hint,
 * rank, escalate, or decide what to say next. The ElevenLabs agent owns the
 * conversation; this owns the seeing. Keeping the split clean is what stops
 * two models from arguing about pedagogy in the same response.
 *
 * GPT-4o with Structured Outputs, strict: true. There is no fixture path and
 * no offline branch — if the key is missing the call fails loudly.
 */

import OpenAI from "openai";

export interface BoundingBox {
  /** Fraction of image width, origin top-left. */
  x: number;
  /** Fraction of image height, origin top-left. */
  y: number;
  /** Fraction of image width. */
  width: number;
  /** Fraction of image height. */
  height: number;
}

export interface VisionObservation {
  observation: string;
  objects: string[];
  boundingBox: BoundingBox;
  confidence: number;
  changedSincePrior: boolean;
  shouldRevealAnswer: false;
}

export type AnalyzeFrameInput = {
  frameDataUrl?: string;
  imageBase64?: string;
  objective?: string;
  priorObservation?: string | null;
  /** Legacy alias kept so older callers keep working. */
  previousObservation?: string | null;
};

const DEFAULT_MODEL = "gpt-4o-2024-08-06";

/**
 * Below 0.3 is the agent's cue to ask the student to reposition rather than
 * guess. The threshold lives here so the prompt and the client agree.
 */
export const LOW_CONFIDENCE = 0.3;

const SYSTEM_PROMPT = `You are LENS Vision. You are a camera, not a tutor.

You look at one frame of a student's workspace and describe what is actually there. A separate tutor decides what to say to the student. You never teach.

Rules:
- Describe only what is visible in this frame. Never infer state you cannot see. Never speculate about intent.
- Never state that anything is wrong. Never state a fix, a correct value, a correct orientation, or a correct component. Never say "should".
- The subject is whatever the student is working on: what their hands are on, what they are holding, or the object nearest the centre of the frame in the foreground. Other people, other people's screens, walls, ceilings, lighting, furniture and anything in the background are NOT the subject, even when they are visually prominent. A busy room is background; the student's work is the subject.
- If the student's hands and their work are not visible in this frame, say exactly that, box the centre of the frame, and set confidence below 0.3. Do not box a background object instead.
- boundingBox surrounds the single thing most worth attention in this frame. Coordinates are fractions of image width and height, origin top-left: x and y are the top-left corner, width and height are the extent. All four are between 0 and 1, and x + width and y + height must not exceed 1.
- If nothing specific stands out, box the main work area and set confidence below 0.4.
- If the frame is dark, blurry, occluded, or the subject is out of view, say exactly that in observation, box your best guess at the work area, and set confidence below 0.3. Do not describe what you cannot see.
- objects lists what is visible, most relevant first, in plain nouns.
- changedSincePrior compares this frame to the prior observation text given to you. If no prior observation is supplied, set it false.
- observation is one or two plain sentences. No preamble.
- shouldRevealAnswer is always false.`;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    observation: {
      type: "string",
      description: "One or two sentences describing only what is visible in the frame.",
    },
    objects: {
      type: "array",
      description: "Visible objects, most relevant first.",
      items: { type: "string" },
    },
    boundingBox: {
      type: "object",
      additionalProperties: false,
      description:
        "Normalized box around the single thing worth attention. Fractions of width/height, origin top-left.",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
      },
      required: ["x", "y", "width", "height"],
    },
    confidence: {
      type: "number",
      description: "0-1. Below 0.3 means the frame could not be read reliably.",
    },
    changedSincePrior: {
      type: "boolean",
      description: "True if this frame differs meaningfully from the prior observation.",
    },
    shouldRevealAnswer: { type: "boolean", enum: [false] },
  },
  required: [
    "observation",
    "objects",
    "boundingBox",
    "confidence",
    "changedSincePrior",
    "shouldRevealAnswer",
  ],
} as const;

const clamp01 = (n: unknown, fallback: number): number => {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
};

/**
 * Keep the box inside the frame. The model returns fractions and occasionally
 * overshoots the right or bottom edge by a few percent; a box that hangs off
 * the frame reads as a misaligned overlay, which is the bug users notice.
 */
function normalizeBox(raw: Partial<BoundingBox> | undefined): BoundingBox {
  const x = clamp01(raw?.x, 0.1);
  const y = clamp01(raw?.y, 0.1);
  const width = clamp01(raw?.width, 0.3);
  const height = clamp01(raw?.height, 0.3);

  return {
    x,
    y,
    width: Math.max(0.01, Math.min(width, 1 - x)),
    height: Math.max(0.01, Math.min(height, 1 - y)),
  };
}

export async function analyzeFrame(input: AnalyzeFrameInput): Promise<VisionObservation> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const image = input.frameDataUrl || input.imageBase64 || "";
  if (!image) {
    throw new Error("No image data supplied to analyzeFrame");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prior = input.priorObservation ?? input.previousObservation ?? null;

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL_VISION || DEFAULT_MODEL,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: { name: "vision_observation", strict: true, schema },
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `What the tutor wants to know: ${input.objective?.trim() || "(not specified — describe the workspace and box whatever is most salient)"}`,
              `Prior observation: ${prior?.trim() || "(none — this is the first look)"}`,
            ].join("\n"),
          },
          { type: "image_url", image_url: { url: image, detail: "high" } },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned no content for the vision analysis.");
  }

  const parsed = JSON.parse(content) as Partial<VisionObservation>;

  // Structured Outputs pins this to false, but the claim "LENS never gives the
  // answer" is the one number the demo puts on screen, so it is enforced twice.
  if (parsed.shouldRevealAnswer !== false) {
    throw new Error("Model attempted to reveal the answer in a vision observation.");
  }

  return {
    observation: String(
      parsed.observation ?? "The frame is not clear enough to describe."
    ),
    objects: Array.isArray(parsed.objects) ? parsed.objects.map(String) : [],
    boundingBox: normalizeBox(parsed.boundingBox),
    confidence: clamp01(parsed.confidence, 0.2),
    changedSincePrior: Boolean(parsed.changedSincePrior),
    shouldRevealAnswer: false,
  };
}

export function formatVisionError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Vision analysis failed.";
}

export function visionConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}


// ─────────────────────────────────────────────────────────────────────
// Reference comparison
// ─────────────────────────────────────────────────────────────────────

export interface FrameComparison {
  /** What differs between the two frames, stated neutrally. */
  difference: string;
  /** Where to look on the student's frame. */
  liveBox: BoundingBox;
  /** The same part on the reference frame. */
  referenceBox: BoundingBox;
  /** What part of the body or object this is about. */
  focus: string;
  confidence: number;
  /** True when the two frames are close enough that nothing stands out. */
  aligned: boolean;
  shouldRevealAnswer: false;
}

const COMPARE_PROMPT = `You are LENS Vision in comparison mode. You are a camera, not a coach.

You are given two images. The FIRST is the student. The SECOND is a reference they chose to work from. Describe how the student's frame differs from the reference.

Rules:
- Describe the difference in plain, neutral, physical terms: where a limb, joint, tool or part sits in one frame versus the other. "The student's left arm is lower and further forward than in the reference."
- NEVER say which one is correct, better, or worse. NEVER say the student is wrong, off, sloppy, or needs to change anything. NEVER give a correction or an instruction. The reference is not automatically right — it is just the other image.
- Pick the SINGLE most noticeable difference. Not a list. If several differ, take the largest.
- liveBox surrounds that part on the student's frame. referenceBox surrounds the same part on the reference frame. Both are fractions of their own image's width and height, origin top-left.
- focus names the body part, joint or object in two or three words.
- If the two frames are close enough that no difference stands out, set aligned true, say so plainly, and box the main subject in each.
- If either frame is too dark, blurry, or the subject is out of view, say exactly that and set confidence below 0.3.
- shouldRevealAnswer is always false.`;

const compareSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    difference: { type: "string" },
    liveBox: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number" }, y: { type: "number" },
        width: { type: "number" }, height: { type: "number" },
      },
      required: ["x", "y", "width", "height"],
    },
    referenceBox: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number" }, y: { type: "number" },
        width: { type: "number" }, height: { type: "number" },
      },
      required: ["x", "y", "width", "height"],
    },
    focus: { type: "string" },
    confidence: { type: "number" },
    aligned: { type: "boolean" },
    shouldRevealAnswer: { type: "boolean", enum: [false] },
  },
  required: [
    "difference", "liveBox", "referenceBox", "focus",
    "confidence", "aligned", "shouldRevealAnswer",
  ],
} as const;

export async function compareFrames(input: {
  liveDataUrl: string;
  referenceDataUrl: string;
  objective?: string;
}): Promise<FrameComparison> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  if (!input.liveDataUrl || !input.referenceDataUrl) {
    throw new Error("compareFrames needs both a live frame and a reference frame");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL_VISION || DEFAULT_MODEL,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: { name: "frame_comparison", strict: true, schema: compareSchema },
    },
    messages: [
      { role: "system", content: COMPARE_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `What the tutor wants to know: ${input.objective?.trim() || "(not specified — report the largest difference)"}\n\nImage 1 is the STUDENT. Image 2 is the REFERENCE.`,
          },
          { type: "image_url", image_url: { url: input.liveDataUrl, detail: "high" } },
          { type: "image_url", image_url: { url: input.referenceDataUrl, detail: "high" } },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content for the comparison.");

  const parsed = JSON.parse(content) as Partial<FrameComparison>;
  if (parsed.shouldRevealAnswer !== false) {
    throw new Error("Model attempted to reveal the answer in a comparison.");
  }

  return {
    difference: String(parsed.difference ?? "The two frames could not be compared."),
    liveBox: normalizeBox(parsed.liveBox),
    referenceBox: normalizeBox(parsed.referenceBox),
    focus: String(parsed.focus ?? "subject"),
    confidence: clamp01(parsed.confidence, 0.2),
    aligned: Boolean(parsed.aligned),
    shouldRevealAnswer: false,
  };
}
