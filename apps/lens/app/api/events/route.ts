/**
 * /api/events — the learning event log.
 *
 * POST  record one event (prediction, retry, pointer use, camera analysis…)
 * GET   ?sessionId=  recent events, oldest first
 *
 * Owner: Person 4. Everything in the reasoning graph and the metrics strip
 * is derived from rows written here, so write liberally and early — an
 * event that was never recorded is a demo beat that cannot be replayed.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { recordEvent, recentEvents } from "@/lib/events";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import type { LensEventType } from "@/lib/lens/contracts";
import { elasticPrimary } from "@/lib/elastic";

export const runtime = "nodejs";

const VALID: LensEventType[] = [
  "prediction",
  "camera_frame_analyzed",
  "pointer_used",
  "hint_requested",
  "understanding_check_answered",
  "experiment_started",
  "experiment_completed",
  "retry",
  "source_opened",
  "voice_turn",
  "mode_changed",
  "understanding_noted",
  "misconception_noted",
  "session_saved",
  "flashcard_reviewed",
  "flashcard_saved",
  "flashcard_unsaved",
  "quiz_answered",
  "quiz_saved",
  "quiz_unsaved",
];

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const type = body.type as LensEventType;

  if (!VALID.includes(type)) {
    return NextResponse.json(
      { error: `Unknown event type "${type}"` },
      { status: 400 }
    );
  }

  // Lazy session creation, same convention as every other write route.
  let sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!sessionId || !elasticPrimary()) {
    try {
      const session = await resolveOrCreateSession(userId, sessionId, "LENS Session");
      sessionId = String(session._id);
    } catch (error) {
      if (!elasticPrimary()) throw error;
      sessionId = crypto.randomUUID();
      console.warn("[events] Mongo session unavailable; using Elastic session:", (error as Error).message);
    }
  }

  const id = await recordEvent({
    sessionId,
    userId,
    type,
    concept: body.concept ?? null,
    payload: body.payload ?? {},
  });

  return NextResponse.json({ id, sessionId });
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ events: [] });

  const limit = Math.min(Number(searchParams.get("limit")) || 40, 200);
  const events = await recentEvents(sessionId, limit);
  return NextResponse.json({ events });
}
