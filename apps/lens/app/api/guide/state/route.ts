/**
 * GET /api/guide/state?sessionId=...&limit=...
 *
 * Reads back the guide_step events that POST /api/guide/step persists, and
 * returns the latest step plus the last few. The voice agent calls this —
 * through a `read_guide_step` client tool — so it can answer "what do I do
 * next?" from the same state the extension is acting on.
 *
 * Auth: Clerk cookie, checked inside the handler rather than in
 * middleware, exactly like /api/guide/step — the extension and the voice
 * agent both call this cross-origin, so it gates the same way.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { guideState } from "@/lib/guide-state";

export const runtime = "nodejs";

// CORS so the extension (chrome-extension://...) can GET here.
function corsHeaders(origin: string | null) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-credentials": "true",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function GET(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"));

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Not signed in to LENS. Open the app and sign in first." },
      { status: 401, headers: cors }
    );
  }

  const params = new URL(req.url).searchParams;
  const sessionId = params.get("sessionId") || "";
  const limit = Math.min(20, Math.max(1, Number(params.get("limit")) || 5));

  if (!sessionId) {
    return NextResponse.json(
      { error: "No sessionId supplied" },
      { status: 400, headers: cors }
    );
  }

  try {
    const state = await guideState(sessionId, limit, userId);
    return NextResponse.json({ sessionId, ...state }, { headers: cors });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Guide state failed" },
      { status: 502, headers: cors }
    );
  }
}
