/**
 * POST /api/notes/search  { query, sessionId }
 *
 * Backs the live agent's search_notes tool. Returns the top few passages
 * from the student's ACTIVE sources in this session as [{ title, text }].
 * Passage text is copied from the source, never generated.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { retrievePassages } from "@/lib/reasoning";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    sessionId?: string | null;
  };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });
  if (!body.sessionId) return NextResponse.json({ passages: [] });

  try {
    const passages = await retrievePassages(userId, body.sessionId, query, 3);
    return NextResponse.json({
      passages: passages.map((p) => ({ title: p.title, text: p.text.slice(0, 600) })),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
