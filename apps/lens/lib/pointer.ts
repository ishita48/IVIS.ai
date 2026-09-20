/**
 * LENS Pointer (screen mode) — Claude Computer Use coordinate detection.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 3 (Pointer & Proof).
 *
 * This is a direct port of ElementLocationDetector.swift from the macOS
 * companion app, moved into a Route Handler so the browser can use it too.
 * The three things that make that Swift file accurate are preserved
 * exactly, because dropping any one of them visibly degrades the pointer:
 *
 *   1. The `computer` tool is DECLARED. That is what activates Claude's
 *      pixel-counting training. A plain vision prompt asking for "the
 *      coordinates" is markedly worse and is not worth demoing.
 *   2. The declared resolution matches the capture's ASPECT RATIO. Forcing
 *      a 16:10 laptop screen into 1024x768 squashes the image and wrecks
 *      X-axis accuracy.
 *   3. Coordinates are clamped, then rescaled back to the real capture
 *      size. Claude occasionally returns values just outside the box.
 *
 * Difference from the Swift version: the resize happens in the browser
 * (see hooks/usePointer.ts), because the client already holds the frame in
 * a <canvas> and resizing there costs nothing and keeps this route free of
 * a native image dependency. The client tells us which resolution it drew
 * to; we validate it against the supported table below before declaring it.
 *
 * Retina note carried over from Swift: the client MUST draw at exact pixel
 * dimensions (canvas.width = target, no devicePixelRatio multiplier). If
 * the image sent is 2x the declared size, every coordinate comes back at
 * half scale.
 */

import type { PointerTarget } from "./lens/contracts";
import { recordCall, anthropicUsage, type LedgerScope } from "./token-ledger";
import { SUPPORTED_RESOLUTIONS } from "./pointer-resolutions";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const POINTER_MODEL = process.env.ANTHROPIC_MODEL_POINTER || "claude-sonnet-4-6";
const COMPUTER_USE_BETA = "computer-use-2025-11-24";
const COMPUTER_TOOL_TYPE = "computer_20251124";

/**
 * Anthropic-recommended Computer Use resolutions, with aspect ratios.
 * Deliberately small — higher resolutions get downsampled by the API and
 * lose precision.
 */
// Lives in ./pointer-resolutions so client code can import it without pulling
// this server module (and the Mongo driver behind the ledger) into the browser.
export { SUPPORTED_RESOLUTIONS };

/** Picks the supported resolution closest in aspect ratio to the real capture. */
export function bestResolution(
  captureWidth: number,
  captureHeight: number
): { width: number; height: number } {
  const aspect = captureWidth / Math.max(1, captureHeight);
  let best = SUPPORTED_RESOLUTIONS[1];
  let smallestDiff = Number.POSITIVE_INFINITY;
  for (const r of SUPPORTED_RESOLUTIONS) {
    const diff = Math.abs(aspect - r.aspect);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      best = r;
    }
  }
  return { width: best.width, height: best.height };
}

export type PointerInput = {
  /** Base64 JPEG/PNG already drawn at `declared` dimensions. */
  imageBase64: string;
  /** What the student asked while looking at this. */
  question: string;
  /** The resolution the client drew the image at. Validated below. */
  declared: { width: number; height: number };
  /** The real on-screen size of the captured surface, in CSS pixels. */
  capture: { width: number; height: number };
  mediaType?: "image/jpeg" | "image/png";
  /** Session to bill the model call to. Unbilled when absent. */
  ledger?: LedgerScope | null;
};

const POINTER_PROMPT = (question: string) => `The student asked this while looking at their screen: "${question}"

Before you do anything else, write exactly these two lines:

LOOKING AT: <one sentence describing what is actually on this screen — the app or page, and what content is in it. Be concrete: name the file, the error, the section, the code. This is the only description a separate tutor will ever get of this screen, so it has to stand on its own.>
POINTING AT: <two to five words naming the specific thing you are about to click, e.g. "line 42, the return" or "the Deploy button">

Then, if there is one specific thing on screen the student should be looking at right now — a sentence, a line of code, a term, a diagram label, a control — click on it.

Click the single most relevant target. Do not click a large container when a specific element inside it is what matters.

Never state the fix, the answer, or what the student should change. You are naming a location, not solving the problem.

If the question is purely conceptual and there is nothing specific on screen to point at, still write both lines (POINTING AT: nothing specific) and do not use the tool.`;

/**
 * Pull the two declared lines out of Claude's text blocks.
 *
 * The label used to be the hardcoded string "Look here", which meant the
 * bubble said the same thing whatever it pointed at, and the voice agent —
 * which is handed this label as its only description of the screen — would
 * tell the student they were looking at "a section labeled Look here". The
 * label and the observation both have to come from the model or the screen
 * pointer is blind downstream.
 */
function parseNarration(text: string): { label: string; observation: string } {
  const looking = text.match(/LOOKING AT:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();
  const pointing = text.match(/POINTING AT:\s*(.+?)(?:\n|$)/i)?.[1]?.trim();

  // Fall back to the raw text rather than inventing a description: a wrong
  // observation is worse than a clumsy one, because the agent speaks it.
  const observation =
    looking ||
    text.replace(/POINTING AT:.*/is, "").trim().slice(0, 300) ||
    "Could not read what is on the screen.";

  const label = pointing && !/^nothing specific$/i.test(pointing) ? pointing : "this";

  return { label: label.slice(0, 60), observation: observation.slice(0, 300) };
}

/**
 * Returns the pixel coordinates of the element to point at, or null when
 * the question is conceptual and there is nothing on screen worth a bubble.
 */
export async function locateOnScreen(
  input: PointerInput
): Promise<PointerTarget | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — LENS Pointer (screen mode) cannot run."
    );
  }

  // Never declare a resolution the tool isn't tuned for: fall back to the
  // aspect-matched supported one if the client sent something unexpected.
  const declared = SUPPORTED_RESOLUTIONS.some(
    (r) => r.width === input.declared.width && r.height === input.declared.height
  )
    ? input.declared
    : bestResolution(input.capture.width, input.capture.height);

  const data = input.imageBase64.replace(/^data:[^;]+;base64,/, "");
  const mediaType = input.mediaType || "image/jpeg";
  const startedAt = Date.now();

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": COMPUTER_USE_BETA,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: POINTER_MODEL,
      max_tokens: 256,
      tools: [
        {
          type: COMPUTER_TOOL_TYPE,
          name: "computer",
          display_width_px: declared.width,
          display_height_px: declared.height,
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data },
            },
            { type: "text", text: POINTER_PROMPT(input.question) },
          ],
        },
      ],
    }),
    // Keep the demo responsive: a pointer that takes 20s is a pointer the
    // audience has stopped watching.
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    void recordCall({
      scope: input.ledger,
      provider: "anthropic",
      model: POINTER_MODEL,
      purpose: "pointer.locate",
      latencyMs: Date.now() - startedAt,
      ok: false,
    });
    throw new Error(
      `Computer Use call failed (${res.status}): ${body.slice(0, 240)}`
    );
  }

  const json = (await res.json()) as {
    content?: { type: string; input?: { coordinate?: number[] }; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  void recordCall({
    scope: input.ledger,
    provider: "anthropic",
    model: POINTER_MODEL,
    purpose: "pointer.locate",
    ...anthropicUsage(json.usage),
    latencyMs: Date.now() - startedAt,
  });

  // Both halves of the response matter: the tool_use block carries the
  // coordinate, the text blocks carry what it is. Reading only the
  // coordinate is what left the agent with nothing to say.
  const narration = parseNarration(
    (json.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n")
  );

  const toolUse = json.content?.find(
    (b) => b.type === "tool_use" && Array.isArray(b.input?.coordinate)
  );
  const coord = toolUse?.input?.coordinate;
  if (!coord || coord.length !== 2) {
    // Claude answered in text — conceptual question, nothing to point at.
    return null;
  }

  // Clamp into the declared space, then rescale to the real capture size.
  const cx = Math.max(0, Math.min(Number(coord[0]), declared.width));
  const cy = Math.max(0, Math.min(Number(coord[1]), declared.height));

  const nx = cx / declared.width;
  const ny = cy / declared.height;

  return {
    x: Math.round(nx * input.capture.width),
    y: Math.round(ny * input.capture.height),
    nx,
    ny,
    label: narration.label,
    observation: narration.observation,
    declared,
  };
}

export function pointerConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
