/**
 * GET /api/sessions/live/[id]
 *
 * Reopen one saved session — transcript, understanding curve, beliefs,
 * predictions and observations, all replayed from the event log rather than
 * read out of a stored summary.
 *
 * Ownership is enforced by the query, not by a check afterwards: the lookup
 * filters on userId, so a sessionId belonging to someone else comes back
 * empty and is reported as not found.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { loadLiveSession } from "@/lib/live-sessions";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing session id" }, { status: 400 });

  try {
    const session = await loadLiveSession(userId, id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not load the session." },
      { status: 502 }
    );
  }
}
