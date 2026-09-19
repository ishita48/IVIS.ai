/**
 * POST /api/reasoning/analyze
 *
 * Runs the reasoning engine over the session's real events plus retrieved
 * excerpts from the student's own material, and writes a reasoning_states
 * document. This is what the reasoning graph animates a new node from.
 *
 * Owner: Person 2.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { analyzeReasoning } from "@/lib/reasoning";
import { resolveOrCreateSession } from "@/lib/session-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const session = await resolveOrCreateSession(userId, body.sessionId, "LENS Session");
  const sessionId = String(session._id);

  try {
    const state = await analyzeReasoning({
      sessionId,
      userId,
      objective: body.objective,
      latestObservation: body.latestObservation ?? null,
      useSources: body.useSources !== false,
    });
    return NextResponse.json({ state, sessionId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Reasoning analysis failed" },
      { status: 502 }
    );
  }
}
