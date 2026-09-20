/**
 * POST /api/dropbox/ingest   (sponsor track - Dropbox)
 *
 * Course folder -> personalized tutor: a connected Dropbox folder becomes the grounding corpus
 * the reasoning engine cites. Body (all optional): { folder?: string (alias: path), sessionId?: string,
 * fileIds?: string[] } - fileIds imports only those Dropbox files (what the in-app picker sends).
 *
 * Reuses the pipeline that already exists - it does NOT add a second one:
 *   list folder -> download -> lib/extract.ts -> insert into `sources` (same shape as
 *   /api/sources/upload, and linked into the session's sourceIds like the other source routes)
 *   -> embedSourceFireAndForget() -> Elastic + Atlas retrieval just work.
 *
 * Re-running is safe: a file whose Dropbox content_hash is unchanged is skipped; a changed file
 * updates its existing source in place (same id, so its Elastic chunks are overwritten).
 *
 * Auth is one shared app, refreshed automatically: lib/dropbox.ts trades DROPBOX_REFRESH_TOKEN
 * for a short-lived access token and re-mints it on expiry, so nobody has to paste a console
 * token before a demo. Per-user OAuth is the upgrade path.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import { extractPdf, extractDocx, extractPlainText, extractXlsx } from "@/lib/extract";
import { embedSourceFireAndForget } from "@/lib/embeddings";
import { trackEvent } from "@/lib/aggregations";
import {
  DropboxError,
  downloadFile,
  dropboxConfigured,
  fileKind,
  getAccessToken,
  listFiles,
} from "@/lib/dropbox";

export const runtime = "nodejs";
// 120s. Vercel Pro allows up to 300s per serverless function; Hobby
// caps at 60 and REJECTS THE BUILD above it. Next requires this to be
// a static literal, so it cannot read the plan — if this ever deploys
// to a Hobby team, every value over 60 here and in vercel.json has to
// come down together.
export const maxDuration = 120;

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES_PER_CALL = 25; // stay inside maxDuration; call again for the rest

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!dropboxConfigured()) {
    return NextResponse.json(
      {
        error:
          "Dropbox is not connected. Set DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN in apps/lens/.env.local and restart.",
      },
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

    const onlyIds: string[] | null = Array.isArray(body?.fileIds)
      ? body.fileIds.filter((x: unknown): x is string => typeof x === "string")
      : null;

    const token = await getAccessToken();
    const all = await listFiles(token, folder);
    const supported = all.filter((f) => fileKind(f.name));
    const unsupported = all.length - supported.length;
    const readable = onlyIds ? supported.filter((f) => onlyIds.includes(f.id)) : supported;
    const sourcesOut: Record<string, unknown>[] = []; // what the UI adds to its list right away

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let deferred = 0;
    const failed: { name: string; error: string }[] = [];

    // One query for every file in the batch. This was a findOne per file,
    // so a 25-file folder paid 25 round trips to Atlas before downloading
    // a single byte. Same index, same filter, one call.
    const heldRows = readable.length
      ? await db
          .collection("sources")
          .find(
            {
              userId,
              sessionId: sessionOid,
              "metadata.dropboxId": { $in: readable.map((f) => f.id) },
            },
            { projection: { kind: 1, active: 1, createdAt: 1, sessionId: 1, metadata: 1 } }
          )
          .toArray()
      : [];
    const held = new Map(heldRows.map((r) => [String(r.metadata?.dropboxId), r]));

    // Decide what to do with each file before touching the network, so the
    // skip and defer counts do not depend on how far the work got.
    const todo: { file: (typeof readable)[number]; existing: any }[] = [];
    for (const f of readable) {
      const existing = held.get(f.id) ?? null;
      if (existing && existing.metadata?.contentHash === f.contentHash) {
        skipped += 1;
        continue;
      }
      if (todo.length >= MAX_FILES_PER_CALL) {
        deferred += 1;
        continue;
      }
      todo.push({ file: f, existing });
    }

    // Download and extract a few at a time. Strictly sequential meant a
    // folder of 25 PDFs served one network round trip at a time inside a
    // 120s budget; four at once is the difference between finishing and
    // timing out. Higher risks Dropbox's rate limiter, which costs more
    // than it saves.
    const CONCURRENCY = 4;
    let cursor = 0;
    // The `if (!userId) return` guard above does not narrow inside a
    // closure, so bind the checked value rather than asserting at each use.
    const ownerId: string = userId;

    async function worker() {
      for (;;) {
        const i = cursor++;
        if (i >= todo.length) return;
        const { file: f, existing } = todo[i];

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
            userId: ownerId,
            sessionId: existing.sessionId ? String(existing.sessionId) : null,
            kind: existing.kind ?? "pdf",
          });
          updated += 1;
          sourcesOut.push({
            _id: String(existing._id), kind: existing.kind ?? "pdf", title, url: null, badge: "dropbox",
            active: existing.active ?? true, metadata, sessionId: String(sessionOid),
            createdAt: existing.createdAt, updatedAt: now,
          });
        } else {
          const doc = {
            userId: ownerId,
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
            { _id: sessionOid, userId: ownerId },
            { $addToSet: { sourceIds: inserted.insertedId }, $set: { updatedAt: now }, $inc: { "metadata.tabCount": 1 } }
          );
          embedSourceFireAndForget(inserted.insertedId.toString(), res.text, title, {
            userId: ownerId,
            sessionId: String(sessionOid),
            kind: doc.kind,
          });
          imported += 1;
          sourcesOut.push({
            _id: String(inserted.insertedId), kind: doc.kind, title, url: null, badge: doc.badge,
            active: true, metadata, sessionId: String(sessionOid), createdAt: now, updatedAt: now,
          });
        }
      } catch (err: any) {
          failed.push({ name: f.name, error: err?.message || "failed" });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker())
    );

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
      sources: sourcesOut,
    });
  } catch (err: any) {
    if (err instanceof DropboxError) {
      return NextResponse.json({ error: err.message, kind: err.kind }, { status: 502 });
    }
    console.error("[dropbox/ingest]", err);
    return NextResponse.json({ error: err?.message || "Dropbox ingest failed" }, { status: 500 });
  }
}
