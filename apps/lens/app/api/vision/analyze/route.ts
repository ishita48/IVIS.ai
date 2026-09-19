/**
 * POST /api/vision/analyze
 *
 * One frame in, one observation out. Called by the browser when the LENS
 * agent invokes its analyze_workspace client tool, and by the manual Analyze
 * fallback button. Also accepts a multipart upload, which is the Wi-Fi
 * fallback: upload a still instead of using the camera, same code path.
 *
 * There is no offline branch, no fixture, and no cached observation here.
 *
 * Privacy: the frame is analyzed and dropped. Nothing writes it to disk or to
 * object storage. Only the derived text leaves this function, which is what
 * makes "we never record your camera" a claim rather than a hope.
 */

import { NextResponse } from "next/server";
import { analyzeFrame, visionConfigured } from "@/lib/vision";
import { formatOpenAIError, openAIErrorStatus } from "@/lib/openai-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (value: unknown): string => (typeof value === "string" ? value : "");

export async function POST(req: Request) {
  if (!visionConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured — LENS Vision is offline." },
      { status: 503 }
    );
  }

  const contentType = req.headers.get("content-type") || "";
  let body: Record<string, unknown> = {};
  let uploaded = "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") || formData.get("image") || formData.get("frame");

    if (file instanceof File) {
      // Node runtime has no FileReader. Go through the buffer instead.
      const bytes = Buffer.from(await file.arrayBuffer());
      const mime = file.type || "image/jpeg";
      uploaded = `data:${mime};base64,${bytes.toString("base64")}`;
    }

    body = Object.fromEntries(formData.entries()) as Record<string, unknown>;
  } else {
    body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const image =
    uploaded ||
    str(body.frameDataUrl) ||
    str(body.image) ||
    str(body.imageBase64) ||
    str(body.imageDataUrl);

  if (!image) {
    return NextResponse.json({ error: "No image supplied" }, { status: 400 });
  }

  const startedAt = Date.now();

  try {
    const observation = await analyzeFrame({
      frameDataUrl: image,
      objective: str(body.objective) || undefined,
      priorObservation: str(body.priorObservation) || str(body.previousObservation) || null,
    });

    return NextResponse.json({
      observation,
      latencyMs: Date.now() - startedAt,
      // Echoed back untouched so existing callers that thread a session id
      // through this route keep working.
      sessionId: str(body.sessionId) || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: formatOpenAIError(err) },
      { status: openAIErrorStatus(err) }
    );
  }
}
