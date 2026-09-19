/**
 * POST /api/dropbox/ingest   (sponsor track - Dropbox)
 *
 * Course folder -> personalized tutor: a connected Dropbox folder becomes the grounding corpus
 * the reasoning engine cites. Body (all optional): { folder?: string (alias: path), sessionId?: string }.
 *
 * Reuses the pipeline that already exists - it does NOT add a second one:
 *   list folder -> download -> lib/extract.ts -> insert into `sources` (same shape as
 *   /api/sources/upload, and linked into the session's sourceIds like the other source routes)
 *   -> embedSourceFireAndForget() -> Elastic + Atlas retrieval just work.
 *
 * Re-running is safe: a file whose Dropbox content_hash is unchanged is skipped; a changed file
 * updates its existing source in place (same id, so its Elastic chunks are overwritten).
 *
 * Auth model for the hackathon: one shared DROPBOX_ACCESS_TOKEN (the developer-console token,
 * which expires after ~4h - regenerate it before the demo). Per-user OAuth is the upgrade path.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import { extractPdf, extractDocx, extractPlainText, extractXlsx } from "@/lib/extract";
import { embedSourceFireAndForget } from "@/lib/embeddings";
import { trackEvent } from "@/lib/aggregations";
import { DropboxError, downloadFile, fileKind, listFiles } from "@/lib/dropbox";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES_PER_CALL = 25; // stay inside maxDuration; call again for the rest

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Dropbox is not connected. Set DROPBOX_ACCESS_TOKEN in apps/lens/.env and restart." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const folder: string =
    (typeof body?.folder === "string" ? body.folder : undefined) ??
    (typeof body?.path === "string" ? body.path : undefined) ??
    process.env.DROPBOX_NOTES_FOLDER ??
    "/notes";

  try {
    const session = await resolveOrCreateSession(userId, body?.sessionId ?? null, "Dropbox sources");
    const sessionOid = session._id as ObjectId;
    const db = await getDb();

    const all = await listFiles(token, folder);
    const readable = all.filter((f) => fileKind(f.name));
    const unsupported = all.length - readable.length;

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let deferred = 0;
    const failed: { name: string; error: string }[] = [];

    let handled = 0;
    for (const f of readable) {
      const existing = await db.collection("sources").findOne({ userId, "metadata.dropboxId": f.id });
      if (existing && existing.metadata?.contentHash === f.contentHash) {
        skipped += 1;
        continue;
      }
      if (handled >= MAX_FILES_PER_CALL) {
        deferred += 1;
        continue;
      }
      handled += 1;

      try {
        if (f.size > MAX_BYTES) throw new Error("file too large (50MB max)");
        const kind = fileKind(f.name)!;
        const bytes = await downloadFile(token, f);
        const res =
          kind === "pdf"
            ? await extractPdf(bytes)
            : kind === "docx"
            ? await extractDocx(bytes)
            : kind === "xlsx"
            ? await extractXlsx(bytes)
            : await extractPlainText(bytes);
        if (!res.ok) throw new Error(`couldn't read it: ${res.error}`);
        if (!res.text.trim()) throw new Error("no text found (a scanned PDF needs OCR)");

        const title = f.name.replace(/\.[^.]+$/, "");
        const metadata = {
          wordCount: res.meta.wordCount ?? res.text.split(/\s+/).length,
          pageCount: res.meta.pageCount ?? null,
          fileName: f.name,
          fileSize: f.size,
          provider: "dropbox",
          dropboxId: f.id,
          dropboxPath: f.path,
          contentHash: f.contentHash,
        };
        const now = new Date();

        if (existing) {
          await db.collection("sources").updateOne(
            { _id: existing._id },
            { $set: { title, extractedText: res.text, metadata, updatedAt: now } }
          );
          embedSourceFireAndForget(existing._id.toString(), res.text, title, {
            userId,
            sessionId: existing.sessionId ? String(existing.sessionId) : null,
            kind: existing.kind ?? "pdf",
          });
          updated += 1;
        } else {
          const doc = {
            userId,
            sessionId: sessionOid,
            kind: "pdf" as const,
            title,
            url: null,
            badge: "dropbox",
            active: true,
            extractedText: res.text,
            metadata,
            createdAt: now,
            updatedAt: now,
          };
          const inserted = await db.collection("sources").insertOne(doc as any);
          // Same as the other source routes: link it into the session so it shows in the Sources tab.
          await db.collection("sessions").updateOne(
            { _id: sessionOid, userId },
            { $addToSet: { sourceIds: inserted.insertedId }, $set: { updatedAt: now }, $inc: { "metadata.tabCount": 1 } }
          );
          embedSourceFireAndForget(inserted.insertedId.toString(), res.text, title, {
            userId,
            sessionId: String(sessionOid),
            kind: doc.kind,
          });
          imported += 1;
        }
      } catch (err: any) {
        failed.push({ name: f.name, error: err?.message || "failed" });
      }
    }

    await trackEvent(userId, "dropbox_sources_imported", {
      filesSeen: all.length,
      filesImported: imported + updated,
      filesSkipped: skipped,
      folder,
    });

    return NextResponse.json({
      ok: true,
      folder,
      sessionId: String(sessionOid),
      imported,
      updated,
      skipped,
      deferred, // > 0: call again to continue
      unsupported,
      failed,
    });
  } catch (err: any) {
    if (err instanceof DropboxError) {
      return NextResponse.json({ error: err.message, kind: err.kind }, { status: 502 });
    }
    console.error("[dropbox/ingest]", err);
    return NextResponse.json({ error: err?.message || "Dropbox ingest failed" }, { status: 500 });
  }
}
