/**
 * GET /api/metrics?sessionId=
 *
 * Every number on the demo metrics strip, aggregated from real collections.
 * Owner: Person 4.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { computeMetrics } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ metrics: null });

  const metrics = await computeMetrics(sessionId);
  return NextResponse.json({ metrics });
}
