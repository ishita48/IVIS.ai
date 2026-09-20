import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import { extractWebpage, extractYouTube, parseYouTubeId } from "@/lib/extract";
import { trackEvent } from "@/lib/aggregations";
import { embedSourceFireAndForget } from "@/lib/embeddings";

export const runtime = "nodejs";
export const maxDuration = 30;

async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { headers: { "user-agent": "Mozilla/5.0 LENS" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url: string = (body.url || "").trim();
  const sessionIdRaw = body.sessionId || null;

  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Valid http(s) URL required" }, { status: 400 });
  }

  const session = await resolveOrCreateSession(userId, sessionIdRaw);
  const sessionOid = session._id as ObjectId;
  const db = await getDb();
  const now = new Date();

  // Auto-detect YouTube and route to YouTube extractor
  const videoId = parseYouTubeId(url);
  if (videoId) {
    const [realTitle, yt] = await Promise.all([
      fetchYouTubeTitle(videoId),
      extractYouTube(url),
    ]);
    if (!yt.ok) {
      return NextResponse.json(
        {
          error:
            yt.error ||
            "Transcript unavailable — this video doesn't have captions",
        },
        { status: 400 }
      );
    }

    const source = {
      userId,
      sessionId: sessionOid,
      kind: "youtube" as const,
      title: body.title || realTitle || `YouTube video — ${videoId}`,
      url,
      content: null,
      extractedText: yt.text,
      badge: "video",
      active: true,
      metadata: {
        wordCount: yt.text.split(/\s+/).filter(Boolean).length,
        language: "en",
        duration: yt.meta.duration ?? null,
        pageCount: null,
        thumbnailUrl: yt.meta.thumbnailUrl ?? null,
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
    embedSourceFireAndForget(result.insertedId, yt.text, source.title, {
      userId,
      sessionId: String(sessionOid),
      kind: source.kind,
    });
    await trackEvent(userId, "source_youtube_added", {
      sourceId: result.insertedId.toString(),
      videoId,
    });

    return NextResponse.json({
      ok: true,
      sessionId: sessionOid.toString(),
      source: { _id: result.insertedId, ...source },
    });
  }

  // Regular webpage
  const res = await extractWebpage(url);
  if (!res.ok || !res.text) {
    return NextResponse.json(
      { error: res.error || "Could not extract page content" },
      { status: 400 }
    );
  }

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
    kind: "webpage" as const,
    title: body.title || res.meta.title || host,
    url,
    content: null,
    extractedText: res.text,
    badge:
      host.includes("brightspace") || host.includes("d2l") ? "LMS" : "web",
    active: true,
    metadata: {
      wordCount:
        res.meta.wordCount ?? res.text.split(/\s+/).filter(Boolean).length,
      language: "en",
      duration: null,
      pageCount: null,
      thumbnailUrl: null,
      host,
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

  embedSourceFireAndForget(result.insertedId, res.text, source.title, {
    userId,
    sessionId: String(sessionOid),
    kind: source.kind,
  });

  await trackEvent(userId, "source_url_added", {
    sourceId: result.insertedId.toString(),
    host,
  });

  return NextResponse.json({
    ok: true,
    sessionId: sessionOid.toString(),
    source: { _id: result.insertedId, ...source },
  });
}
