import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import {
  extractWebpage,
  extractYouTube,
  parseYouTubeId,
} from "@/lib/extract";
import { trackEvent } from "@/lib/aggregations";
import { embedSourceFireAndForget } from "@/lib/embeddings";

export const runtime = "nodejs";
export const maxDuration = 60;

async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { headers: { "user-agent": "Mozilla/5.0 StudiO" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch {
    return null;
  }
}

type IngestResult = {
  url: string;
  ok: boolean;
  source?: any;
  error?: string;
};

async function ingestOne(
  userId: string,
  sessionOid: ObjectId,
  url: string
): Promise<IngestResult> {
  try {
    const db = await getDb();
    const now = new Date();
    const videoId = parseYouTubeId(url);

    // YouTube
    if (videoId) {
      const [realTitle, yt] = await Promise.all([
        fetchYouTubeTitle(videoId),
        extractYouTube(url),
      ]);
      if (!yt.ok || !yt.text) {
        return { url, ok: false, error: yt.error || "No transcript" };
      }
      const source = {
        userId,
        sessionId: sessionOid,
        kind: "youtube" as const,
        title: realTitle || `YouTube — ${videoId}`,
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
        url: url ?? null,
      });
      return {
        url,
        ok: true,
        source: { _id: result.insertedId, ...source },
      };
    }

    // Regular webpage
    const res = await extractWebpage(url);
    if (!res.ok || !res.text) {
      return { url, ok: false, error: res.error || "Extraction failed" };
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
      title: res.meta.title || host,
      url,
      content: null,
      extractedText: res.text,
      badge:
        host.includes("brightspace") || host.includes("d2l") ? "LMS" : "web",
      active: true,
      metadata: {
        wordCount:
          res.meta.wordCount ??
          res.text.split(/\s+/).filter(Boolean).length,
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
        url: url ?? null,
    });

    return {
      url,
      ok: true,
      source: { _id: result.insertedId, ...source },
    };
  } catch (e: any) {
    return { url, ok: false, error: e?.message || "Ingest failed" };
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawUrls: unknown = body.urls;
  const sessionIdRaw = body.sessionId || null;

  if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
    return NextResponse.json(
      { error: "urls (array of strings) required" },
      { status: 400 }
    );
  }

  // Dedupe + validate
  const urls = Array.from(
    new Set(
      rawUrls
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter((u) => /^https?:\/\//i.test(u))
    )
  ).slice(0, 15); // cap at 15

  if (urls.length === 0) {
    return NextResponse.json(
      { error: "No valid http(s) URLs in list" },
      { status: 400 }
    );
  }

  const session = await resolveOrCreateSession(userId, sessionIdRaw);
  const sessionOid = session._id as ObjectId;

  // Run in parallel but cap concurrency to 5 to avoid hammering
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += 5) chunks.push(urls.slice(i, i + 5));
  const results: IngestResult[] = [];
  for (const chunk of chunks) {
    const batch = await Promise.all(
      chunk.map((u) => ingestOne(userId, sessionOid, u))
    );
    results.push(...batch);
  }

  const added = results.filter((r) => r.ok).length;
  await trackEvent(userId, "sources_bulk_ingest", {
    total: urls.length,
    added,
    failed: urls.length - added,
  });

  return NextResponse.json({
    ok: true,
    sessionId: sessionOid.toString(),
    added,
    total: urls.length,
    results,
  });
}
