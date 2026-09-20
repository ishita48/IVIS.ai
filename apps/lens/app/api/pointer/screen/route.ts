/**
 * POST /api/pointer/screen
 *
 * Real Claude Computer Use call on a real screen capture. Returns pixel
 * coordinates of the one element the student should be looking at, or
 * `{ target: null }` when the question is conceptual.
 *
 * Owner: Person 3.
 *
 * The client must send the image already drawn at `declared` dimensions —
 * see hooks/usePointer.ts. If you change that resize, change it there, not
 * here: the declared resolution and the actual pixel size of the image have
 * to agree or every coordinate comes back at the wrong scale.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { locateOnScreen, pointerConfigured, bestResolution } from "@/lib/pointer";
import { recordEvent } from "@/lib/events";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import { elasticPrimary } from "@/lib/elastic";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!pointerConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured — LENS Pointer is offline." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const image: string = body.image || "";
  const question: string = (body.question || "").trim();

  if (!image) return NextResponse.json({ error: "No image supplied" }, { status: 400 });
  if (!question)
    return NextResponse.json({ error: "No question supplied" }, { status: 400 });

  const capture = {
    width: Number(body.captureWidth) || 1440,
    height: Number(body.captureHeight) || 900,
  };
  const declared =
    body.declaredWidth && body.declaredHeight
      ? { width: Number(body.declaredWidth), height: Number(body.declaredHeight) }
      : bestResolution(capture.width, capture.height);

  let sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!sessionId || !elasticPrimary()) {
    try {
      const session = await resolveOrCreateSession(userId, sessionId, "LENS Session");
      sessionId = String(session._id);
    } catch (error) {
      sessionId = crypto.randomUUID();
      console.warn("[pointer] Mongo session unavailable; using Elastic session:", (error as Error).message);
    }
  }

  try {
    const target = await locateOnScreen({
      imageBase64: image,
      question,
      declared,
      capture,
      mediaType: body.mediaType || "image/jpeg",
    });

    await recordEvent({
      sessionId,
      userId,
      type: "pointer_used",
      concept: body.concept ?? null,
      payload: {
        question,
        found: !!target,
        label: target?.label ?? null,
        x: target?.x ?? null,
        y: target?.y ?? null,
        mode: "screen",
      },
    }).catch((error) => console.warn("[pointer] event persistence failed:", (error as Error).message));

    return NextResponse.json({ target, sessionId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Pointer detection failed" },
      { status: 502 }
    );
  }
}
