/**
 * GET /api/dropbox/files?sessionId=&folder=
 *
 * Lists the supported files in the connected Dropbox folder, and for each one says whether it is
 * already in THIS session ("added"), in it but changed in Dropbox since ("changed"), or not yet ("new").
 * This is what the Dropbox tab of the "Add a study source" dialog renders. Read-only: nothing is saved.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { DropboxError, dropboxConfigured, fileKind, getAccessToken, listFiles } from "@/lib/dropbox";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const folder = searchParams.get("folder") ?? process.env.DROPBOX_NOTES_FOLDER ?? "/notes";
  const sessionId = searchParams.get("sessionId");

  if (!dropboxConfigured()) {
    return NextResponse.json(
      {
        error:
          "Dropbox isn't connected yet. Add DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN to apps/lens/.env.local and restart.",
        code: "not_connected",
        folder,
      },
      { status: 503 }
    );
  }

  try {
    const token = await getAccessToken();
    const all = await listFiles(token, folder);
    const readable = all.filter((f) => fileKind(f.name));

    // dropboxId -> contentHash of what this session already holds
    const held = new Map<string, string>();
    if (sessionId && ObjectId.isValid(sessionId) && readable.length) {
      const db = await getDb();
      const rows = await db
        .collection("sources")
        .find(
          { userId, sessionId: new ObjectId(sessionId), "metadata.dropboxId": { $in: readable.map((f) => f.id) } },
          { projection: { "metadata.dropboxId": 1, "metadata.contentHash": 1 } }
        )
        .toArray();
      for (const r of rows) held.set(r.metadata.dropboxId, r.metadata.contentHash);
    }

    return NextResponse.json({
      folder,
      unsupported: all.length - readable.length,
      files: readable.map((f) => ({
        id: f.id,
        name: f.name,
        path: f.path,
        size: f.size,
        kind: fileKind(f.name),
        status: !held.has(f.id) ? "new" : held.get(f.id) === f.contentHash ? "added" : "changed",
      })),
    });
  } catch (err: any) {
    if (err instanceof DropboxError) {
      return NextResponse.json({ error: err.message, code: err.kind, folder }, { status: 502 });
    }
    console.error("[dropbox/files]", err);
    return NextResponse.json({ error: err?.message || "Couldn't list Dropbox files", folder }, { status: 500 });
  }
}
