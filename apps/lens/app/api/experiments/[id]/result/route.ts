/**
 * POST /api/experiments/[id]/result
 *
 * Records the REAL outcome of an experiment and immediately re-runs the
 * reasoning engine, so the graph updates from what actually happened rather
 * than from what the student said would happen.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { recordEvent } from "@/lib/events";
import { analyzeReasoning } from "@/lib/reasoning";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Bad experiment id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const db = await getDb();

  const experiment = await db
    .collection("experiments")
    .findOne({ _id: new ObjectId(id), userId });
  if (!experiment) {
    return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  }

  await db.collection("experiments").updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        studentPrediction: body.studentPrediction ?? experiment.studentPrediction ?? null,
        actualOutcome: body.actualOutcome ?? null,
        status: "completed",
        completedAt: new Date(),
      },
    }
  );

  const sessionId = String(experiment.sessionId);

  await recordEvent({
    sessionId,
    userId,
    type: "experiment_completed",
    concept: experiment.concept,
    payload: {
      experimentId: id,
      studentPrediction: body.studentPrediction ?? experiment.studentPrediction ?? null,
      actualOutcome: body.actualOutcome ?? null,
      predictionHeld:
        !!body.studentPrediction &&
        String(body.studentPrediction).trim() === String(body.actualOutcome || "").trim(),
    },
  });

  // The outcome is new evidence — reconstruct the student model right away.
  const result = await analyzeReasoning({
    sessionId,
    userId,
    objective: body.objective,
  }).catch(() => null);
  // A skipped analysis (not in the student's notes) has no state to return.
  const state = result && "state" in result ? result.state : null;

  return NextResponse.json({ ok: true, state });
}
