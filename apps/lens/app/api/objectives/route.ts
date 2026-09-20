/**
 * GET /api/objectives
 *
 * The demo objective registry without its ladders: ids, titles and the
 * objective text the client should send. Enough for a picker; nothing a
 * student could read the answer from. Auth is the Clerk middleware.
 */

import { NextResponse } from "next/server";
import { listObjectives } from "@/lib/objectives";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ objectives: listObjectives() });
}
