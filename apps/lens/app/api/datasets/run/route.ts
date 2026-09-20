/**
 * POST /api/datasets/run
 *
 * The data objective's whole loop, in one call:
 *
 *   1. record what the student predicted, before anything runs;
 *   2. run the question's snippet against the committed slice, for real;
 *   3. record what actually came back;
 *   4. wake the reasoning engine, which finds the prediction and the
 *      result sitting in the session's events and serves the rung the
 *      session has earned.
 *
 * Step 1 has to happen first and has to be persisted. A prediction made
 * after seeing the answer is not a prediction, and the ladder in
 * `lib/reasoning.ts` reads the session's events, not this request body.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { findQuestion, objectiveTextFor } from "@/lib/datasets";
import { parseRows } from "@/lib/datasets/csv";
import { sliceForQuestion } from "@/lib/datasets/load";
import { recordEvent } from "@/lib/events";
import { generateReferenceImage } from "@/lib/grok";
import { analyzeReasoning } from "@/lib/reasoning";
import { resolveOrCreateSession } from "@/lib/session-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const datasetId: string = (body.datasetId || "").trim();
  const questionId: string = (body.questionId || "").trim();
  const prediction: string = (body.prediction || "").trim();

  if (!datasetId || !questionId) {
    return NextResponse.json(
      { error: "datasetId and questionId are required" },
      { status: 400 }
    );
  }
  if (!prediction) {
    return NextResponse.json(
      { error: "A prediction is required before the query runs." },
      { status: 400 }
    );
  }

  const found = findQuestion(datasetId, questionId);
  if (!found) {
    return NextResponse.json({ error: "No such dataset question" }, { status: 404 });
  }
  const { dataset, question } = found;

  const session = await resolveOrCreateSession(userId, body.sessionId, dataset.title);
  const sessionId = String(session._id ?? session.id ?? body.sessionId);

  // 1 — the commitment, on the record before any number exists.
  await recordEvent({
    sessionId,
    userId,
    type: "prediction",
    concept: `${dataset.id}:${question.id}`,
    payload: {
      prediction,
      question: question.prompt,
      datasetId: dataset.id,
      questionId: question.id,
    },
  });

  // 2 — the real query, against the real slice.
  const slice = await sliceForQuestion(dataset, question);
  const rows = parseRows(slice);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "The committed slice is empty.", sessionId },
      { status: 500 }
    );
  }

  let answer: string;
  try {
    answer = question.compute(rows).trim();
  } catch (error) {
    return NextResponse.json(
      {
        error: "The query failed — the prediction was still recorded.",
        detail: error instanceof Error ? error.message : String(error),
        sessionId,
      },
      { status: 500 }
    );
  }

  if (!answer) {
    return NextResponse.json(
      { error: "The query produced no answer.", sessionId },
      { status: 500 }
    );
  }

  // 3 — what the data actually said.
  await recordEvent({
    sessionId,
    userId,
    type: "experiment_completed",
    concept: `${dataset.id}:${question.id}`,
    payload: {
      answer,
      prediction,
      datasetId: dataset.id,
      questionId: question.id,
      rows: rows.length,
    },
  });

  // 4 — the ladder. The cap is the engine's; nothing here overrides it.
  const reasoning = await analyzeReasoning({
    sessionId,
    userId,
    objective: objectiveTextFor(dataset, question),
  });

  // 5 — optional Grok chart of the true answer. Never blocks the response.
  const chartPrompt =
    dataset.id === "nasa-exoplanets" && question.id === "bigger-than-jupiter"
      ? "a histogram of exoplanet radii in Jupiter radii, log scale, minimal, no text"
      : dataset.id === "nasa-exoplanets" && question.id === "hot-jupiter-orbits"
        ? "a scatter of hot Jupiter orbital distance in AU inside Mercury, minimal, no text"
        : `a minimal chart of the data answer: ${answer}, no text`;

  const referenceImageUrl = await generateReferenceImage(chartPrompt).catch(
    () => null
  );

  return NextResponse.json({
    sessionId,
    prediction,
    answer,
    reasoning,
    referenceImageUrl,
  });
}
