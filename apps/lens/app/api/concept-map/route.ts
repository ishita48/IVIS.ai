/**
 * GET  /api/concept-map?sessionId=   → { map }
 * POST /api/concept-map { sessionId } → { outcome, map }
 *
 * The per-session concept map, built from the student's own turns. POST
 * folds any new turns into it (see lib/conceptmap.ts).
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { sessionScopedFilter } from "@/lib/groups";
import { getConceptMap, updateConceptMap } from "@/lib/conceptmap";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId || !(await sessionScopedFilter(userId, sessionId))) {
    return NextResponse.json({ map: null });
  }
  return NextResponse.json({ map: await getConceptMap(sessionId) });
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
