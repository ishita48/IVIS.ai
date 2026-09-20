/**
 * POST /api/vision/task-check — "am I doing this right? am I done?"
 *
 * Task mode's checker. The student states what they are trying to do, does
 * it in front of the camera, and asks. One frame in, one verdict out:
 * done, almost, or not yet.
 *
 * WHY THIS DOES NOT BREAK THE PROMISE. LENS never gives the answer, and a
 * verdict is not an answer — it is the same thing the Code tab does when
 * it runs a student's program and reports a failing case. Checking whether
 * work is finished is the one question a tutor may answer outright,
 * because the student did the work and is asking about their own result.
 *
 * WHERE THE LINE IS, and it matters most at `almost`: saying what is
 * missing IS the answer for a physical task. "The resistor is in the wrong
 * row" hands over the fix. So the model may name WHERE to look and may
 * describe what it observes, and may not say what to change, what the
 * correct arrangement is, or what to do next. `detail` is one short
 * sentence under that rule, and the ladder still governs everything the
 * voice agent says separately.
 *
 * CONFIDENCE IS REPORTED, NOT HIDDEN. A camera pointed at a dim desk from
 * a bad angle produces a guess, and a tutor that says "yes, done!" to a
 * guess teaches the student to distrust every later yes. Below the floor
 * the verdict becomes `unclear`, which asks for a better view instead of
 * inventing a judgement.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { recordCall, openaiUsage } from "@/lib/token-ledger";
import { recordEvent } from "@/lib/events";
import { resolveOrCreateSession } from "@/lib/session-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Below this the model is guessing, and a guess must not read as a verdict. */
const CONFIDENCE_FLOOR = 0.45;

const SYSTEM = `You judge whether a student has completed a hands-on task, from one photograph.

You are given the task in the student's own words and an image of their work.

Decide one of:
  done     the task is visibly complete and correct
  almost   the work is clearly under way and close, but something is not right yet
  not_yet  little or none of the task is done, or the work is wrong in a basic way
  unclear  you cannot see enough of the work to judge

RULES ON WHAT YOU MAY SAY:
- You may name WHERE to look: a region, a component, a side, a step.
- You may describe what you observe.
- You may NOT say what to change, what the correct arrangement is, what is
  missing, or what to do next. Naming the fix defeats the entire product.
- At "done" you may simply confirm it and say what you saw that convinced you.

confidence is your honest certainty from this image alone, 0 to 1. A poor
angle, bad light, or an obscured subject means low confidence and "unclear",
not a guess dressed as a verdict.

Reply as json:
{"status":"done"|"almost"|"not_yet"|"unclear","detail":string,"seen":string,"confidence":number}
detail: one short sentence, under the rules above.
seen: what is actually visible, plainly.`;

type Verdict = {
  status: "done" | "almost" | "not_yet" | "unclear";
  detail?: string;
  seen?: string;
  confidence?: number;
};

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    task?: string;
    frameDataUrl?: string;
    sessionId?: string;
  };

  const task = String(body.task || "").trim();
  const frame = String(body.frameDataUrl || "");

  if (!task) {
    return NextResponse.json({ error: "Say what you're trying to do first." }, { status: 400 });
  }
  if (!frame.startsWith("data:image/")) {
    return NextResponse.json({ error: "No camera frame to look at." }, { status: 400 });
  }

  try {
    // Sent through the OpenAI client directly rather than llmJson, which
    // takes a string prompt and would quietly stringify the image into
    // "[object Object]". Same shape lib/vision.ts uses for a frame.
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL_VISION || "gpt-4o";
    const startedAt = Date.now();

    const response = await client.chat.completions.create({
      model,
      temperature: 0.1,
      max_tokens: 260,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `The student's task, in their words: "${task}"

Judge it as json.`,
            },
            { type: "image_url", image_url: { url: frame, detail: "high" } },
          ],
        },
      ],
    });

    void recordCall({
      scope: { sessionId: String(body.sessionId || ""), userId },
      provider: "openai",
      model,
      purpose: "vision.task_check",
      ...openaiUsage(response.usage),
      latencyMs: Date.now() - startedAt,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("The model returned nothing to judge with.");
    const out = JSON.parse(content) as Verdict;

    const confidence = Number(out?.confidence);
    const conf = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;

    // A low-confidence verdict is downgraded rather than shown. The student
    // gets "I can't see it well enough", which is true and actionable.
    const status: Verdict["status"] =
      conf < CONFIDENCE_FLOOR && out?.status !== "unclear" ? "unclear" : (out?.status ?? "unclear");

    const verdict = {
      status,
      detail:
        status === "unclear" && out?.status !== "unclear"
          ? "I can't see the work clearly enough to judge — try a closer or better-lit angle."
          : String(out?.detail || "").trim(),
      seen: String(out?.seen || "").trim(),
      confidence: conf,
    };

    // Recorded so the session history shows the attempt, and so a repeated
    // "not_yet" on the same task is visible to the reasoning engine later.
    try {
      const session = await resolveOrCreateSession(userId, body.sessionId, "Task");
      await recordEvent({
        sessionId: String(session._id),
        userId,
        type: verdict.status === "done" ? "experiment_completed" : "retry",
        concept: task.slice(0, 80),
        payload: { surface: "task", task, ...verdict },
      }).catch(() => undefined);
    } catch {
      // The verdict is the product; failing to log it must not withhold it.
    }

    return NextResponse.json(verdict);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Couldn't check that." },
      { status: 502 }
    );
  }
}
