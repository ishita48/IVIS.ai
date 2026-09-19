/**
 * POST /api/vision/compare
 *
 * Two frames in, one difference out. The student's camera and a frame from a
 * reference video they chose.
 *
 * The reference is not treated as ground truth — the model is told explicitly
 * that it is "just the other image". LENS points at the gap and lets the
 * student decide what it means, which is the same rule the rest of the product
 * runs on: show the evidence, never state the fix.
 */

import { NextResponse } from "next/server";
import { compareFrames, visionConfigured } from "@/lib/vision";
import { formatOpenAIError, openAIErrorStatus } from "@/lib/openai-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function POST(req: Request) {
  if (!visionConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured — LENS Vision is offline." },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const live = str(body.liveDataUrl);
  const reference = str(body.referenceDataUrl);

  if (!live || !reference) {
    return NextResponse.json(
      { error: "Both liveDataUrl and referenceDataUrl are required." },
      { status: 400 }
    );
  }

  const startedAt = Date.now();

  try {
    const comparison = await compareFrames({
      liveDataUrl: live,
      referenceDataUrl: reference,
      objective: str(body.objective) || undefined,
    });

    return NextResponse.json({ comparison, latencyMs: Date.now() - startedAt });
  } catch (err) {
    return NextResponse.json(
      { error: formatOpenAIError(err) },
      { status: openAIErrorStatus(err) }
    );
  }
}
