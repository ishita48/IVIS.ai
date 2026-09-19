/**
 * POST /api/sandbox/run  (P1 — LENS Proof tier)
 *
 * Runs real code in a real sandbox. Two modes:
 *   { language, source, stdin }                    → one execution
 *   { language, source, reference, candidates[] }  → shrink to the smallest
 *                                                    failing input
 *
 * Owner: Person 3. Do not start this until the P0 camera loop is solid.
 *
 * The model never decides whether the code is wrong. Execution decides;
 * the model only explains the divergence afterwards.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { runCode, shrinkToFailingCase } from "@/lib/sandbox";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const language: string = body.language || "python";
  const source: string = body.source || "";
  if (!source) return NextResponse.json({ error: "No source supplied" }, { status: 400 });

  try {
    if (body.reference && Array.isArray(body.candidates) && body.candidates.length) {
      const failing = await shrinkToFailingCase({
        language,
        studentSource: source,
        referenceSource: body.reference,
        candidates: body.candidates.slice(0, 25),
      });
      return NextResponse.json({ mode: "shrink", failing });
    }

    const result = await runCode({ language, source, stdin: body.stdin });
    return NextResponse.json({ mode: "run", result });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Sandbox execution failed" },
      { status: 502 }
    );
  }
}
