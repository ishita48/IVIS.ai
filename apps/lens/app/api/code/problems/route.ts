/**
 * GET /api/code/problems — the problem list for the editor tab.
 *
 * Returns the problem statement, the starter (buggy) code and the input the
 * fixture is known to fail on. It does NOT return `rootCause`, which is the
 * one-line answer — that stays server-side and is only ever used as private
 * context when generating a ladder-capped hint.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { listProblems } from "@/lib/coding";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ problems: listProblems() });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not load problems." },
      { status: 502 }
    );
  }
}
