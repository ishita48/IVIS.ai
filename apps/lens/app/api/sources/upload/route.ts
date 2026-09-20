/**
 * POST /api/sources/upload — file → extracted text → embedded source.
 * ─────────────────────────────────────────────────────────────────────
 * Trimmed for LENS. What came out: Cloudinary hosting (thumbnails and
 * HLS playback belonged to the video feature) and audio/video lecture
 * transcription. What stayed: the extraction + embedding path, which is
 * the half the Sources tier actually needs.
 *
 * If you re-add lecture audio for the ElevenLabs sponsor track, extend
 * lib/extract.ts and this route — do not build a parallel ingest path.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import {
  extractPdf,
  extractDocx,
  extractPlainText,
  extractXlsx,
  extractAudio,
} from "@/lib/extract";
import { trackEvent } from "@/lib/aggregations";
import { embedSourceFireAndForget } from "@/lib/embeddings";
import { elasticPrimary, indexSourceInElasticNow } from "@/lib/elastic";

export const runtime = "nodejs";
// Vercel's Hobby plan caps a function at 60s and rejects the build
// outright above it. Next requires this to be a static literal, so it
// cannot be computed from the plan — raise it here (and in
// vercel.json) if the project moves to Pro, which allows 300.
export const maxDuration = 60;

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    const sessionIdRaw = (form.get("sessionId") as string) || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (200MB max)" }, { status: 413 });
    }

    const name = file.name || "upload";
    const type = file.type || "";
    const lower = name.toLowerCase();

    const isPdf = type.includes("pdf") || lower.endsWith(".pdf");
    const isDocx = type.includes("wordprocessingml") || lower.endsWith(".docx");
    const isXlsx = type.includes("spreadsheetml") || lower.endsWith(".xlsx");
    const isText = type.startsWith("text/") || /\.(txt|md|csv|tsv)$/i.test(lower);
    const isAudio = type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|webm|aac)$/i.test(lower);
    const isVideo = type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(lower);

    if (!isAudio && !isVideo && file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "Document too large (50MB max)" }, { status: 413 });
    }

    if (!isPdf && !isDocx && !isXlsx && !isText && !isAudio && !isVideo) {
      return NextResponse.json(
        { error: "Unsupported file type. PDF, DOCX, XLSX, TXT/MD/CSV, audio, or video." },
        { status: 415 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    const res = isPdf
      ? await extractPdf(bytes)
      : isDocx
      ? await extractDocx(bytes)
      : isXlsx
      ? await extractXlsx(bytes)
      : isAudio || isVideo
      ? await extractAudio(bytes, name, type)
      : await extractPlainText(bytes);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Couldn't read that file: ${res.error}` },
        { status: 400 }
      );
    }

    const now = new Date();
    let sessionOid: ObjectId | null = null;
    let resolvedSessionId = sessionIdRaw;
    try {
      const session = await resolveOrCreateSession(userId, sessionIdRaw, "LENS Session");
      sessionOid = session._id as ObjectId;
      resolvedSessionId = String(session._id);
    } catch (error) {
      if (!elasticPrimary()) throw error;
      console.warn("[sources/upload] Mongo session unavailable; continuing with Elastic:", (error as Error).message);
    }

    const doc = {
      userId,
      sessionId: sessionOid,
      kind: isVideo ? "video" as const : isAudio ? "audio" as const : "pdf" as const,
      title: name.replace(/\.[^.]+$/, ""),
      url: null,
      badge: isPdf ? "pdf" : isDocx ? "docx" : isXlsx ? "xlsx" : "text",
      active: true,
      extractedText: res.text,
      metadata: {
        wordCount: res.meta.wordCount ?? 0,
        pageCount: res.meta.pageCount ?? null,
        fileName: name,
        fileSize: file.size,
        mediaType: type || null,
      },
      createdAt: now,
      updatedAt: now,
    };

    const elasticId = insertedIdForElastic(name, userId, resolvedSessionId || "unscoped");
    const elasticChunks = elasticPrimary()
      ? await indexSourceInElasticNow({
          id: elasticId,
          userId,
          sessionId: resolvedSessionId,
          title: doc.title,
          kind: doc.kind,
          url: (doc as any)?.url ?? null,
          active: true,
          text: res.text,
        })
      : 0;

    let sourceId = elasticId;
    if (sessionOid) {
      try {
        const db = await getDb();
        const inserted = await db.collection("sources").insertOne(doc as any);
        sourceId = inserted.insertedId.toString();

        // Mongo stores the embedding as a fallback copy; Elastic is already indexed.
        embedSourceFireAndForget(sourceId, res.text, name, {
          userId,
          sessionId: String(sessionOid),
          kind: doc.kind,
        });
      } catch (error) {
        if (!elasticPrimary()) throw error;
        console.warn("[sources/upload] Mongo source persistence skipped; Elastic is primary:", (error as Error).message);
      }
    }

    try {
      await trackEvent(userId, "source_uploaded", {
        kind: doc.badge,
        wordCount: doc.metadata.wordCount,
      });
    } catch {
      // Elastic indexing is the authoritative success path here.
    }

    return NextResponse.json({
      source: { ...doc, _id: sourceId, sessionId: resolvedSessionId, elasticChunks },
      sessionId: resolvedSessionId,
    });
  } catch (err: any) {
    console.error("[sources/upload]", err);
    return NextResponse.json(
      { error: err?.message || "Upload failed" },
      { status: 500 }
    );
  }
}

function insertedIdForElastic(name: string, userId: string, sessionId: string) {
  return `${userId}:${sessionId}:${name}`.replace(/[^a-zA-Z0-9:_-]/g, "_");
}
