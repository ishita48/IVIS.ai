/**
 * POST /api/vision/analyze
 *
 * Takes a base64 frame — from getUserMedia() in Guided Camera Mode, or from
 * an uploaded image — and runs a real OpenAI vision call with a strict JSON
 * schema. Persists the derived observation and logs a learning event.
 *
 * Owner: Person 2.
 *
 * ONE code path, TWO input sources. The Section 19 Wi-Fi fallback is "upload
 * a still instead of using the camera", which lands here identically. There
 * is no offline branch, no fixture, and no cached observation in this route.
 *
 * Privacy: `storagePath` is intentionally never written. Only the derived
 * observation is persisted — the raw frame is analyzed and dropped. If you
 * later add Cloudinary storage for replay, make it opt-in and say so in the
 * UI, because "we never store your camera frames" is a claim worth keeping.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { analyzeFrame, visionConfigured } from "@/lib/vision";
import { recordEvent } from "@/lib/events";
import { resolveOrCreateSession } from "@/lib/session-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!visionConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured — LENS Vision is offline." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const image: string = body.image || body.imageBase64 || "";
  if (!image) {
    return NextResponse.json({ error: "No image supplied" }, { status: 400 });
  }

  const session = await resolveOrCreateSession(userId, body.sessionId, "LENS Session");
  const sessionId = String(session._id);

  try {
    const { observation, latencyMs, model } = await analyzeFrame({
      imageBase64: image,
      objective: body.objective,
      previousObservation: body.previousObservation ?? null,
    });

    const db = await getDb();
    await db.collection("camera_frames").insertOne({
      sessionId: new ObjectId(sessionId),
      userId,
      // storagePath deliberately omitted — see the header note.
      observation: observation.observation,
      objects: observation.objects,
      boundingBox: observation.boundingBox,
      confidence: observation.confidence,
      possibleIssue: observation.possibleIssue ?? null,
      source: body.source === "upload" ? "upload" : "camera",
      latencyMs,
      model,
      createdAt: new Date(),
    } as any);

    await recordEvent({
      sessionId,
      userId,
      type: "camera_frame_analyzed",
      concept: observation.possibleIssue ?? null,
      payload: {
        observation: observation.observation,
        confidence: observation.confidence,
        objects: observation.objects,
        shouldRevealAnswer: observation.shouldRevealAnswer,
        latencyMs,
        source: body.source === "upload" ? "upload" : "camera",
      },
    });

    return NextResponse.json({ observation, latencyMs, model, sessionId });
  } catch (err: any) {
    // Fail loudly. A silent fallback here is how a demo ends up showing a
    // canned observation without anyone noticing.
    return NextResponse.json(
      { error: err?.message || "Vision analysis failed" },
      { status: 502 }
    );
  }
}
