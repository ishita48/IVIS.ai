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
  const url = (body.url || "").trim();
  const sessionIdRaw = body.sessionId || null;

  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const session = await resolveOrCreateSession(userId, sessionIdRaw);
  const sessionOid = session._id as ObjectId;

  const videoId = parseYouTubeId(url);
  if (!videoId) {
    return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }

  // Fetch title and transcript in parallel
  const [realTitle, res] = await Promise.all([
    fetchYouTubeTitle(videoId),
    extractYouTube(url),
  ]);

  if (!res.ok) {
    return NextResponse.json(
      {
        error:
          res.error ||
          "Transcript unavailable — this video has captions disabled",
      },
      { status: 400 }
    );
  }

  const db = await getDb();
  const now = new Date();
  const title = body.title || realTitle || `YouTube video — ${videoId}`;

  const source = {
    userId,
    sessionId: sessionOid,
    kind: "youtube" as const,
    title,
    url,
    content: null,
    extractedText: res.text,
    badge: "video",
    active: true,
    metadata: {
      wordCount: res.text.split(/\s+/).filter(Boolean).length,
      language: "en",
      duration: res.meta.duration ?? null,
      pageCount: null,
      thumbnailUrl: res.meta.thumbnailUrl ?? null,
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

  embedSourceFireAndForget(result.insertedId, res.text, title, {
    userId,
    sessionId: String(sessionOid),
    kind: source.kind,
        url: url ?? null,
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
