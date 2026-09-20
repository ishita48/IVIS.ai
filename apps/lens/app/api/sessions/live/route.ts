/**
 * /api/sessions/live — saved tutoring sessions.
 *
 * GET   list the caller's sessions, newest activity first
 * POST  save one: `{ sessionId, title? }`
 *
 * Saving writes exactly one `session_saved` event and nothing else. The
 * session's contents were already recorded as they happened, so there is no
 * snapshot to take — see lib/live-sessions.ts for why that is the point.
 *
 * An unsaved session still appears in the list. Saving is how you name it
 * and mark it worth keeping; it is not what makes it exist.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { recordEvent } from "@/lib/events";
import { listLiveSessions, suggestTitle } from "@/lib/live-sessions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 50, 200);

  try {
    const sessions = await listLiveSessions(userId, limit);
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not list saved sessions." },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    title?: string;
  };

  const sessionId = String(body.sessionId || "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    // A blank title is not an error — it means "keep this, you name it".
    const given = String(body.title || "").trim();
    const title = (given || (await suggestTitle(userId, sessionId))).slice(0, 120);

    await recordEvent({
      sessionId,
      userId,
      type: "session_saved",
      payload: { title, named: !!given },
    });

    return NextResponse.json({ sessionId, title });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not save the session." },
      { status: 502 }
    );
  }
}
