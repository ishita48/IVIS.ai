/**
 * POST /api/guide/step
 *
 * One turn of a LENS Guide walkthrough. Takes the student's goal plus a
 * screenshot of their actual browser viewport, and returns the next step
 * with the pixel coordinates of the control it names.
 *
 * Owner: Person 3.
 *
 * Auth: Clerk cookie, checked inside the handler rather than in
 * middleware, because this is called cross-origin from the Chrome
 * extension's service worker. Same arrangement as /api/sources/capture —
 * see the note at the top of middleware.ts.
 *
 * The client must send the image already drawn at `declared` dimensions.
 * The extension does that resize in an OffscreenCanvas (see
 * extension/background.js). If you change it there, change it in
 * hooks/usePointer.ts too — all three have to agree on the rule that the
 * declared resolution and the image's real pixel size are the same number.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { nextGuideStep, guideConfigured } from "@/lib/guide";
import { bestResolution } from "@/lib/pointer";
import { recordEvent } from "@/lib/events";
import { resolveOrCreateSession } from "@/lib/session-helpers";

export const runtime = "nodejs";
export const maxDuration = 45;

// CORS so the extension (chrome-extension://...) can POST here.
function corsHeaders(origin: string | null) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "POST, OPTIONS",
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

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"));

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Not signed in to LENS. Open the app and sign in first." },
      { status: 401, headers: cors }
    );
  }

  if (!guideConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured — LENS Guide is offline." },
      { status: 503, headers: cors }
    );
  }

  const body = await req.json().catch(() => ({}));
  const goal: string = (body.goal || "").trim();
  const image: string = body.image || "";

  if (!goal) {
    return NextResponse.json(
      { error: "No goal supplied" },
      { status: 400, headers: cors }
    );
  }
  if (!image) {
    return NextResponse.json(
      { error: "No image supplied" },
      { status: 400, headers: cors }
    );
  }

  const capture = {
    width: Number(body.captureWidth) || 1440,
    height: Number(body.captureHeight) || 900,
  };
  const declared =
    body.declaredWidth && body.declaredHeight
      ? { width: Number(body.declaredWidth), height: Number(body.declaredHeight) }
      : bestResolution(capture.width, capture.height);

  // History is student-supplied, so cap it rather than trusting the length.
  const history: string[] = Array.isArray(body.history)
    ? body.history.filter((h: unknown) => typeof h === "string").slice(-20)
    : [];

  const session = await resolveOrCreateSession(userId, body.sessionId, "LENS Guide");
  const sessionId = String(session._id);

  try {
    const result = await nextGuideStep({
      goal,
      imageBase64: image,
      declared,
      capture,
      history,
      pageUrl: body.pageUrl || null,
      pageTitle: body.pageTitle || null,
      mediaType: body.mediaType || "image/jpeg",
      ledger: { sessionId, userId },
    });

    await recordEvent({
      sessionId,
      userId,
      type: "guide_step",
      concept: body.concept ?? null,
      payload: {
        goal,
        step: result.step,
        // Recorded so the metrics strip can show that the question was
        // asked rather than the answer given — that is the claim.
        askedWhy: !!result.why,
        why: result.why,
        status: result.status,
        observation: result.observation,
        pointed: !!result.target,
        x: result.target?.x ?? null,
        y: result.target?.y ?? null,
        index: result.index,
        pageUrl: body.pageUrl || null,
        mode: "extension",
      },
    });

    return NextResponse.json({ step: result, sessionId }, { headers: cors });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Guide step failed" },
      { status: 502, headers: cors }
    );
  }
}
