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
} from "@/lib/extract";
import { trackEvent } from "@/lib/aggregations";
import { embedSourceFireAndForget } from "@/lib/embeddings";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 50 * 1024 * 1024;

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
      return NextResponse.json({ error: "File too large (50MB max)" }, { status: 413 });
    }

    const name = file.name || "upload";
    const type = file.type || "";
    const lower = name.toLowerCase();

    const isPdf = type.includes("pdf") || lower.endsWith(".pdf");
    const isDocx = type.includes("wordprocessingml") || lower.endsWith(".docx");
    const isXlsx = type.includes("spreadsheetml") || lower.endsWith(".xlsx");
    const isText = type.startsWith("text/") || /\.(txt|md|csv|tsv)$/i.test(lower);

    if (!isPdf && !isDocx && !isXlsx && !isText) {
      return NextResponse.json(
        { error: "Unsupported file type. PDF, DOCX, XLSX, or plain text." },
        { status: 415 }
      );
    }

    const session = await resolveOrCreateSession(userId, sessionIdRaw, "LENS Session");
    const sessionOid = session._id as ObjectId;
    const bytes = Buffer.from(await file.arrayBuffer());

    const res = isPdf
      ? await extractPdf(bytes)
      : isDocx
      ? await extractDocx(bytes)
      : isXlsx
      ? await extractXlsx(bytes)
      : await extractPlainText(bytes);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Couldn't read that file: ${res.error}` },
        { status: 400 }
      );
    }

    const db = await getDb();
    const now = new Date();
    const doc = {
      userId,
      sessionId: sessionOid,
      kind: "pdf" as const,
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
      },
      createdAt: now,
      updatedAt: now,
    };

    const inserted = await db.collection("sources").insertOne(doc as any);

    // Embedding is fire-and-forget: a student should not wait on a vector
    // write to see their file appear in the list.
    embedSourceFireAndForget(inserted.insertedId.toString(), res.text, name, {
      userId,
      sessionId: String(sessionOid),
      kind: doc.kind,
    });

    await trackEvent(userId, "source_uploaded", {
      kind: doc.badge,
      wordCount: doc.metadata.wordCount,
    });

    return NextResponse.json({
      source: { ...doc, _id: inserted.insertedId.toString(), sessionId: String(sessionOid) },
      sessionId: String(sessionOid),
    });
  } catch (err: any) {
    console.error("[sources/upload]", err);
    return NextResponse.json(
      { error: err?.message || "Upload failed" },
      { status: 500 }
    );
  }
}
