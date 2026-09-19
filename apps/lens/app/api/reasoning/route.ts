/**
 * GET /api/reasoning?sessionId=&timeline=1
 *
 * Latest reasoning state, or the full ordered history when `timeline=1`.
 * The graph UI reads the timeline; the camera state machine reads latest.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { latestReasoningState, reasoningTimeline } from "@/lib/reasoning";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ state: null, timeline: [] });

  if (searchParams.get("timeline")) {
    const timeline = await reasoningTimeline(sessionId);
    return NextResponse.json({ timeline, state: timeline[timeline.length - 1] ?? null });
  }

  const state = await latestReasoningState(sessionId);
  return NextResponse.json({ state });
}
