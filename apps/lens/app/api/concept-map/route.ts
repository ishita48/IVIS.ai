/**
 * GET  /api/concept-map?sessionId=   → { map, pendingTurns }
 * POST /api/concept-map { sessionId } → { outcome, map, pendingTurns }
 *
 * The per-session concept map, built from the whole conversation (typed and
 * spoken, both roles). POST folds any new turns into it and drains the
 * backlog; pendingTurns is what is still waiting (see lib/conceptmap.ts).
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { sessionScopedFilter } from "@/lib/groups";
import { getConceptState, updateConceptMap } from "@/lib/conceptmap";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId || !(await sessionScopedFilter(userId, sessionId))) {
    return NextResponse.json({ map: null, pendingTurns: 0 });
  }
  return NextResponse.json(await getConceptState(sessionId, userId));
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!body.sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  if (!(await sessionScopedFilter(userId, body.sessionId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json(await updateConceptMap({ sessionId: body.sessionId, userId }));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
