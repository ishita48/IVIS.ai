/**
 * LENS Guide — goal-aware screen walkthrough.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 3 (Pointer & Proof).
 *
 * `lib/pointer.ts` answers "where is the thing I asked about". This
 * answers the harder one: "given that I am trying to accomplish X, and
 * given THIS screen, what is the next move and where is it". The
 * difference is state — a goal that outlives the frame, and a history of
 * what has already been done, so the model is choosing the next step
 * rather than re-answering the same question against a new screenshot.
 *
 * Everything that makes pointer.ts accurate is preserved verbatim here
 * and for the same reasons — the `computer` tool is DECLARED (that is
 * what turns on pixel-counting), the declared resolution matches the
 * capture's aspect ratio, and coordinates are clamped then rescaled.
 * Read the header of pointer.ts before changing any of it.
 *
 * On the pedagogy: see the GuideStep doc comment in lens/contracts.ts.
 * `step` may instruct. `why` may not. That line is enforced in the
 * prompt below and re-checked in `sanitizeWhy` after the model answers,
 * because a prompt rule that is never verified is a rule we are hoping
 * for rather than one we have.
 */

import { SUPPORTED_RESOLUTIONS, bestResolution } from "./pointer";
import { realKey } from "./env-keys";
import type { GuideStep, GuideStatus, PointerTarget } from "./lens/contracts";
import { recordCall, anthropicUsage, type LedgerScope } from "./token-ledger";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GUIDE_MODEL =
  process.env.ANTHROPIC_MODEL_GUIDE ||
  process.env.ANTHROPIC_MODEL_POINTER ||
  "claude-sonnet-4-6";
const COMPUTER_USE_BETA = "computer-use-2025-11-24";
const COMPUTER_TOOL_TYPE = "computer_20251124";

export type GuideInput = {
  /** What the student is trying to accomplish, in their own words. */
  goal: string;
  /** Base64 JPEG/PNG already drawn at `declared` dimensions. */
  imageBase64: string;
  /** The resolution the client drew the image at. Validated below. */
  declared: { width: number; height: number };
  /** The real on-screen size of the captured viewport, in CSS pixels. */
  capture: { width: number; height: number };
  /** Steps already issued for this goal, oldest first. */
  history: string[];
  /** Where they are, so the model can tell a reload from a navigation. */
  pageUrl?: string | null;
  pageTitle?: string | null;
  mediaType?: "image/jpeg" | "image/png";
  /** Session to bill the model call to. Unbilled when absent. */
  ledger?: LedgerScope | null;
};

/** Steps older than this stop earning their tokens. */
const HISTORY_WINDOW = 8;

const GUIDE_PROMPT = (input: GuideInput) => {
  const history = input.history.slice(-HISTORY_WINDOW);
  const historyBlock = history.length
    ? history.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "(nothing yet — this is the first screen)";

  return `The student is trying to accomplish this:

GOAL: ${input.goal}

WHERE THEY ARE: ${input.pageTitle || "untitled"} — ${input.pageUrl || "unknown URL"}

STEPS YOU HAVE ALREADY GIVEN THEM:
${historyBlock}

The screenshot is their actual browser viewport right now. Work only from what is visible in it. Do not assume a menu is open, a field is filled, or a page has loaded unless you can see it.

Decide the ONE next action that moves them toward the goal FROM THIS SCREEN.

First, output a text block containing ONLY this JSON and nothing else:

{"observation": "...", "step": "...", "why": "...", "status": "on_track" | "off_track" | "blocked" | "done"}

  observation — one sentence on what this screen actually is. If it is not what your last step should have produced, say so plainly.
  step        — one imperative sentence naming the control by the label printed on it, e.g. "Click Launch instance." Name a real visible label, never a guess. If status is "done" or "blocked", describe the situation instead.
  why         — a QUESTION for the student about why this step matters, answerable from what is in front of them. THIS IS NOT OPTIONAL AND IT IS NOT A STATEMENT. Never explain; ask. If this step is pure navigation with nothing to understand (scrolling, dismissing a banner, expanding a section), use null.
  status      — "on_track" if this screen is where your last step should have led; "off_track" if they are somewhere the goal does not pass through; "blocked" if nothing here can advance the goal (an error, a permissions wall, the wrong account); "done" if the goal is visibly accomplished on this screen.

Then, unless status is "done" or "blocked", use the computer tool to click the exact control your step names. Click the specific control, not the panel or card containing it.

Hard rules:
  - ONE step. Never a sequence, never "then", never a numbered list inside step.
  - Only name a control you can actually see in the screenshot.
  - "why" is always a question or null. If you find yourself writing "because", you have broken the rule — turn it into the question it answers.
  - If the screen is mid-load or too blurry to read, say that in observation, set status "off_track", and do not call the tool.`;
};

/**
 * The model occasionally writes `why` as a statement despite the rule. We
 * would rather drop it than ship an explanation through a field the UI
 * labels as a question — a leaked explanation is the one regression this
 * product cannot absorb.
 */
function sanitizeWhy(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const why = raw.trim();
  if (!why) return null;
  if (!why.endsWith("?")) return null;
  // "X because Y?" is an explanation wearing a question mark.
  if (/\bbecause\b/i.test(why)) return null;
  return why;
}

function asStatus(raw: unknown): GuideStatus {
  return raw === "off_track" || raw === "blocked" || raw === "done"
    ? raw
    : "on_track";
}

/** Tolerant JSON extraction — fenced, bare, or embedded in prose. */
function parseGuideJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(c.slice(start, end + 1));
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return {};
}

/**
 * One turn of the walkthrough: reads the current screen, returns the next
 * step and where to click it. Throws on transport/config failure so the
 * route can surface a real error rather than a plausible-looking step.
 */
export async function nextGuideStep(input: GuideInput): Promise<GuideStep> {
  const apiKey = realKey(process.env.ANTHROPIC_API_KEY);
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set (or is still the sk-ant-... placeholder) — LENS Guide cannot run. Paste a real key into apps/lens/.env.local and restart next dev."
    );
  }

  // Never declare a resolution the tool isn't tuned for. Same guard, and
  // the same reason, as locateOnScreen.
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
      model: GUIDE_MODEL,
      // Larger than the pointer's 256: this one also writes the step and
      // the question, and a truncated JSON block is an unparseable turn.
      max_tokens: 700,
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
            { type: "text", text: GUIDE_PROMPT(input) },
          ],
        },
      ],
    }),
    // A walkthrough runs this on every click. Past ~25s the student has
    // already moved on and the coordinates describe a screen that is gone.
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    void recordCall({
      scope: input.ledger,
      provider: "anthropic",
      model: GUIDE_MODEL,
      purpose: "guide.step",
      latencyMs: Date.now() - startedAt,
      ok: false,
    });
    throw new Error(
      `Computer Use call failed (${res.status}): ${body.slice(0, 240)}`
    );
  }

  const json = (await res.json()) as {
    content?: {
      type: string;
      input?: { coordinate?: number[] };
      text?: string;
    }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const blocks = json.content || [];

  void recordCall({
    scope: input.ledger,
    provider: "anthropic",
    model: GUIDE_MODEL,
    purpose: "guide.step",
    ...anthropicUsage(json.usage),
    latencyMs: Date.now() - startedAt,
  });

  const text = blocks
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("\n");
  const parsed = parseGuideJson(text);

  const status = asStatus(parsed.status);
  const step =
    typeof parsed.step === "string" && parsed.step.trim()
      ? parsed.step.trim()
      : "Look at the screen and tell LENS what you see.";
  const observation =
    typeof parsed.observation === "string" && parsed.observation.trim()
      ? parsed.observation.trim()
      : "";

  // Coordinates — same clamp-then-rescale as the pointer. Absent on a
  // "done"/"blocked" turn, and absent whenever the model declined to click.
  const toolUse = blocks.find(
    (b) => b.type === "tool_use" && Array.isArray(b.input?.coordinate)
  );
  const coord = toolUse?.input?.coordinate;

  let target: PointerTarget | null = null;
  if (coord && coord.length === 2 && status !== "done" && status !== "blocked") {
    const cx = Math.max(0, Math.min(Number(coord[0]), declared.width));
    const cy = Math.max(0, Math.min(Number(coord[1]), declared.height));
    const nx = cx / declared.width;
    const ny = cy / declared.height;
    target = {
      x: Math.round(nx * input.capture.width),
      y: Math.round(ny * input.capture.height),
      nx,
      ny,
      label: step,
      // Guide already parses its own read of the screen — reuse it rather
      // than describing the screen twice in one response.
      observation,
      declared,
    };
  }

  return {
    step,
    why: sanitizeWhy(parsed.why),
    status,
    target,
    observation,
    // The client owns numbering; it knows how many steps this goal has had.
    index: input.history.length,
  };
}

export function guideConfigured(): boolean {
  return realKey(process.env.ANTHROPIC_API_KEY) !== null;
}
