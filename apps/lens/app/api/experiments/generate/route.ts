/**
 * POST /api/experiments/generate
 *
 * Given a misconception, generates the SMALLEST test of it: a hypothesis,
 * the fewest steps that isolate one variable, a prediction question asked
 * BEFORE the student acts, and a reflection question asked after.
 *
 * Owner: Person 3 (with Person 2's prompt conventions).
 *
 * The prediction question is the pedagogically load-bearing part. A student
 * who predicts before acting has committed to a belief, which is what makes
 * the result informative instead of just another thing they watched happen.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { llmJson } from "@/lib/llm";
import { recordEvent } from "@/lib/events";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import type { Experiment } from "@/lib/lens/contracts";

export const runtime = "nodejs";
export const maxDuration = 45;

const SYSTEM = `You design the smallest possible experiment that tests one belief.

Given a misconception a student appears to hold, produce an experiment they can run in under a minute with what is already in front of them.

Hard constraints:
- Change exactly ONE variable. If your steps change two things, the result proves nothing.
- "steps" must be physical or executable actions, not reasoning ("reverse the LED, then look again" — not "consider what polarity means").
- "predictionQuestion" is asked BEFORE they act and must not hint at the outcome.
- "reflectionQuestion" is asked AFTER and must ask WHY, not WHAT.
- Never state the correct answer anywhere in the output.`;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const misconception: string = (body.misconception || "").trim();
  if (!misconception) {
    return NextResponse.json({ error: "No misconception supplied" }, { status: 400 });
  }

  const session = await resolveOrCreateSession(userId, body.sessionId, "LENS Session");
  const sessionId = String(session._id);

  try {
    const out = await llmJson<{
      hypothesis: string;
      steps: string[];
      predictionQuestion: string;
      reflectionQuestion: string;
    }>(
      SYSTEM,
      `Misconception: ${misconception}
Concept slug: ${body.concept || "unknown"}
What the student is working with: ${body.context || "(not stated)"}

Respond with JSON: { "hypothesis": string, "steps": string[], "predictionQuestion": string, "reflectionQuestion": string }`,
      { temperature: 0.4, maxTokens: 700 }
    );

    const db = await getDb();
    const doc = {
      sessionId: new ObjectId(sessionId),
      userId,
      concept: body.concept || "unknown",
      hypothesis: out.hypothesis,
      steps: Array.isArray(out.steps) ? out.steps.slice(0, 5) : [],
      predictionQuestion: out.predictionQuestion,
      reflectionQuestion: out.reflectionQuestion,
      status: "pending" as const,
      studentPrediction: null,
      actualOutcome: null,
      createdAt: new Date(),
      completedAt: null,
    };
    const res = await db.collection("experiments").insertOne(doc as any);

    await recordEvent({
      sessionId,
      userId,
      type: "experiment_started",
      concept: doc.concept,
      payload: { experimentId: res.insertedId.toString(), hypothesis: doc.hypothesis },
    });

    const experiment: Experiment = {
      ...doc,
      _id: res.insertedId.toString(),
      sessionId,
      createdAt: doc.createdAt.toISOString(),
      completedAt: null,
    };

    return NextResponse.json({ experiment, sessionId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Experiment generation failed" },
      { status: 502 }
    );
  }
}
