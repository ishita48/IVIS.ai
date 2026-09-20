/**
 * GET /api/datasets
 *
 * The data objectives a student can pick, with their prediction questions
 * and nothing else. Ladders, misconceptions and fixes stay on the server —
 * this is the same rule `GET /api/objectives` follows.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { listDatasets } from "@/lib/datasets";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ datasets: listDatasets() });
}
