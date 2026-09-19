import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import { extractYouTube, parseYouTubeId } from "@/lib/extract";
import { trackEvent } from "@/lib/aggregations";
import { embedSourceFireAndForget } from "@/lib/embeddings";

export const runtime = "nodejs";
export const maxDuration = 45;

// CORS so the extension (chrome-extension://...) can POST here
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

/**
 * POST /api/sources/capture
 * Body: { url, title, content, sourceType, sessionId? }
 * Auth: Clerk cookie (extension shares the same browser cookies as the StudiO tab)
 *
 * For YouTube URLs with empty content, we auto-fetch the transcript.
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Not signed in to LENS. Open the app and sign in first." },
      { status: 401, headers: cors }
    );
  }

  const body = await req.json().catch(() => ({}));
  const url: string = (body.url || "").trim();
  let title: string = (body.title || "").trim();
  let content: string = (body.content || "").toString();
  const sourceType: string | null = body.sourceType || null;
  const sessionIdRaw: string | null = body.sessionId || null;

  if (!url) {
    return NextResponse.json(
      { error: "url required" },
      { status: 400, headers: cors }
    );
  }

  const session = await resolveOrCreateSession(userId, sessionIdRaw);
  const sessionOid = session._id as ObjectId;

  // Auto-detect YouTube and pull transcript (content from page is just the description)
  let kind: "youtube" | "webpage" | "pdf" | "brightspace" = "webpage";
  let badge = "web";
  let duration: number | null = null;
  let thumbnailUrl: string | null = null;

  const ytId = parseYouTubeId(url);
  if (ytId || sourceType === "youtube") {
    kind = "youtube";
    badge = "video";
    const yt = await extractYouTube(url);
    if (yt.ok && yt.text.length > 50) {
      // Prefer transcript over the description the content script scraped
      content = yt.text;
      duration = yt.meta.duration ?? null;
      thumbnailUrl = yt.meta.thumbnailUrl ?? null;
    } else if (ytId) {
      thumbnailUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    }
    if (!title) title = `YouTube — ${ytId || "video"}`;
  } else if (sourceType === "brightspace" || /brightspace|d2l/i.test(url)) {
    kind = "brightspace";
    badge = "LMS";
  } else if (sourceType === "pdf" || /\.pdf(\?|$)/i.test(url)) {
    kind = "pdf";
    badge = "pdf";
  }

  // Cap the content size
  content = (content || "").slice(0, 20000);
  if (!title) {
    try {
      title = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      title = "Untitled source";
    }
  }

  if (!content.trim()) {
    return NextResponse.json(
      { error: "No extractable content on that page" },
      { status: 400, headers: cors }
    );
  }

  const db = await getDb();
  const now = new Date();
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "webpage";
    }
  })();

  const source = {
    userId,
    sessionId: sessionOid,
    kind,
    title,
    url,
    content: null,
    extractedText: content,
    badge,
    active: true,
    metadata: {
      wordCount: content.split(/\s+/).filter(Boolean).length,
      language: "en",
      duration,
      pageCount: null,
      thumbnailUrl,
      host,
      capturedBy: "extension",
    },
    embedding: null,
    createdAt: now,
  };

  const result = await db.collection("sources").insertOne(source as any);
  await db.collection("sessions").updateOne(
    { _id: sessionOid, userId },
    {
      $addToSet: { sourceIds: result.insertedId },
      $set: { updatedAt: now },
      $inc: { "metadata.tabCount": 1 },
    }
  );

  embedSourceFireAndForget(result.insertedId, content, source.title);

  await trackEvent(userId, "source_captured_via_extension", {
    sourceId: result.insertedId.toString(),
    kind,
    host,
  });

  return NextResponse.json(
    {
      ok: true,
      sessionId: sessionOid.toString(),
      source: { _id: result.insertedId, ...source },
    },
    { headers: cors }
  );
}
