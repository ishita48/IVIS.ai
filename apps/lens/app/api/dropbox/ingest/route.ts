/**
 * POST /api/dropbox/ingest   (sponsor track — Dropbox)
 *
 * Course folder → personalized tutor. Dropbox's own challenge brief names
 * this exact use case, which is why it maps onto LENS's Sources tier with
 * no product contortion: a connected folder becomes the grounding corpus
 * the reasoning engine cites.
 *
 * Owner: Person 4.
 *
 * THIS IS A SCAFFOLD, NOT A WORKING INTEGRATION. It intentionally does not
 * fake a response — an unimplemented integration that returns plausible
 * JSON is worse than one that 501s, because you find out on stage. Finish
 * the two TODOs below and it becomes real.
 *
 * Shape of the work (all of it reuses pipeline that already exists):
 *   1. OAuth: redirect to Dropbox, store the access token on the user doc.
 *   2. files/list_folder → for each file, files/download → Buffer.
 *   3. Pipe the Buffer through lib/extract.ts (PDF/docx/text already handled).
 *   4. Insert into `sources` exactly like /api/sources/upload does, then
 *      embedSourceFireAndForget() — retrieval then works with zero changes.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import {
  extractDocx,
  extractPdf,
  extractPlainText,
  extractXlsx,
} from "@/lib/extract";
import { embedSourceFireAndForget } from "@/lib/embeddings";
import { trackEvent } from "@/lib/aggregations";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILES = 50;
const MAX_BYTES = 50 * 1024 * 1024;

type DropboxEntry = { ".tag": string; name: string; path_lower?: string; size?: number };

async function dropboxRequest(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`https://api.dropboxapi.com/2/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Dropbox ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response;
}

async function listFiles(path: string, token: string) {
  const entries: DropboxEntry[] = [];
  let cursor: string | null = null;
  do {
    const response = cursor
      ? await dropboxRequest("files/list_folder/continue", token, {
          method: "POST",
          body: JSON.stringify({ cursor }),
        })
      : await dropboxRequest("files/list_folder", token, {
          method: "POST",
          body: JSON.stringify({ path, recursive: true, include_deleted: false }),
        });
    const data = (await response.json()) as {
      entries?: DropboxEntry[];
      has_more?: boolean;
      cursor?: string;
    };
    entries.push(...(data.entries || []));
    cursor = data.has_more ? data.cursor || null : null;
  } while (cursor && entries.length < MAX_FILES * 2);
  return entries
    .filter((entry) => entry[".tag"] === "file" && entry.path_lower)
    .slice(0, MAX_FILES);
}

async function downloadFile(path: string, token: string) {
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });
  if (!response.ok) {
    throw new Error(`Dropbox download ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("File exceeds 50MB limit");
  return bytes;
}

function extractFile(name: string, bytes: Buffer) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return extractPdf(bytes);
  if (lower.endsWith(".docx")) return extractDocx(bytes);
  if (lower.endsWith(".xlsx")) return extractXlsx(bytes);
  if (/\.(txt|md|csv|tsv)$/i.test(lower)) return Promise.resolve(extractPlainText(bytes));
  return null;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "Dropbox is not connected. Set DROPBOX_ACCESS_TOKEN (or finish the OAuth flow) before calling this.",
      },
      { status: 501 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const folder = typeof body.path === "string" ? body.path : "";
    const session = await resolveOrCreateSession(userId, body.sessionId, "Dropbox sources");
    const sessionId = String(session._id);
    const sessionOid = session._id as ObjectId;
    const entries = await listFiles(folder, token);
    const db = await getDb();
    const errors: { name: string; error: string }[] = [];
    let imported = 0;
    let skipped = 0;

    for (const entry of entries) {
      const extractor = extractFile(entry.name, await downloadFile(entry.path_lower!, token).catch((error) => {
        errors.push({ name: entry.name, error: error instanceof Error ? error.message : "Download failed" });
        return Buffer.alloc(0);
      }));
      if (!extractor) {
        skipped += 1;
        continue;
      }
      const result = await extractor.catch((error) => ({
        ok: false,
        text: "",
        meta: {},
        error: error instanceof Error ? error.message : "Extraction failed",
      }));
      if (!result.ok || !result.text.trim()) {
        skipped += 1;
        errors.push({ name: entry.name, error: result.error || "No extractable text" });
        continue;
      }
      const now = new Date();
      const source = {
        userId,
        sessionId: sessionOid,
        kind: "pdf",
        title: entry.name.replace(/\.[^.]+$/, ""),
        url: null,
        badge: "dropbox",
        active: true,
        extractedText: result.text,
        metadata: {
          wordCount: (result.meta as Record<string, any>).wordCount ?? result.text.split(/\s+/).length,
          pageCount: (result.meta as Record<string, any>).pageCount ?? null,
          fileName: entry.name,
          fileSize: entry.size ?? null,
          provider: "dropbox",
        },
        createdAt: now,
        updatedAt: now,
      };
      const inserted = await db.collection("sources").insertOne(source as any);
      await db.collection("sessions").updateOne(
        { _id: sessionOid, userId },
        { $addToSet: { sourceIds: inserted.insertedId }, $set: { updatedAt: now }, $inc: { "metadata.tabCount": 1 } }
      );
      embedSourceFireAndForget(inserted.insertedId, result.text, source.title, {
        userId,
        sessionId,
        kind: source.kind,
      });
      imported += 1;
    }

    await trackEvent(userId, "dropbox_sources_imported", {
      filesSeen: entries.length,
      filesImported: imported,
      filesSkipped: skipped,
      folder,
    });
    return NextResponse.json({
      ok: true,
      sessionId,
      filesSeen: entries.length,
      filesImported: imported,
      filesSkipped: skipped,
      chunksIndexed: imported ? "queued" : 0,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dropbox import failed" },
      { status: 502 }
    );
  }
}
