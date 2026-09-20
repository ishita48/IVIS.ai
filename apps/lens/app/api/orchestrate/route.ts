/**
 * POST /api/orchestrate
 *
 * Runs the four-pass reasoning pipeline over a session and returns both the
 * conclusion and the trace that produced it.
 *
 * The trace is returned to the client, not just logged. A tutor that says
 * "I think you believe X" is asking to be trusted; one that shows which
 * passes ran, which were skipped and why, and whether a second model call
 * agreed with the first, is showing its working. That is the difference
 * between a demo claim and a checkable one.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { runCouncil } from "@/lib/orchestrator";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import { formatOpenAIError, openAIErrorStatus } from "@/lib/openai-errors";

export const runtime = "nodejs";
// 90s. Vercel Pro allows up to 300s per serverless function; Hobby
// caps at 60 and REJECTS THE BUILD above it. Next requires this to be
// a static literal, so it cannot read the plan — if this ever deploys
// to a Hobby team, every value over 60 here and in vercel.json has to
// come down together.
export const maxDuration = 90;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    objective?: string;
    latestObservation?: string | null;
  };

  try {
    const session = await resolveOrCreateSession(userId, body.sessionId, "LENS Session");
    const sessionId = String(session._id);

    const { state, trace, recalled } = await runCouncil({
      sessionId,
      userId,
      objective: body.objective,
      latestObservation: body.latestObservation ?? null,
    });

    return NextResponse.json({
      state,
      trace,
      recalled: recalled.map((m) => ({
        belief: m.belief,
        surface: m.surface,
        occurrences: m.occurrences,
        score: m.score,
        firstSeenAt: m.firstSeenAt,
      })),
      sessionId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: formatOpenAIError(error) },
      { status: openAIErrorStatus(error) }
    );
  }
}
