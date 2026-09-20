import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/mongodb";
import { trackEvent } from "@/lib/aggregations";
import { embedSourceFireAndForget } from "@/lib/embeddings";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { sessionScopedFilter } from "@/lib/groups";
import {
  deleteElasticSource,
  elasticPrimary,
  listSourcesElastic,
  searchSourcesElastic,
  setElasticSourceActive,
  sourceKindCounts,
} from "@/lib/elastic";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  const kind = searchParams.get("kind");
  const activeOnly = searchParams.get("active") !== "false";
  const search = searchParams.get("q");

  // Elastic first, and BEFORE getDb(). Previously this route opened a Mongo
  // connection on line one, so an Atlas outage 500'd the whole endpoint and
  // the Sources panel rendered empty — which read as "my uploads did not
  // save" even though every chunk was sitting in Elastic.
  if (elasticPrimary()) {
    try {
      const rows = search?.trim()
        ? await searchSourcesElastic({ userId, sessionId, kind, query: search })
        : await listSourcesElastic({ userId, sessionId, kind });

      if (rows) {
        const counts = await sourceKindCounts({ userId, sessionId }).catch(() => null);
        return NextResponse.json(
          activeOnly ? rows.filter((r) => r.active) : rows,
          { headers: { "x-lens-kind-counts": JSON.stringify(counts ?? {}) } }
        );
      }
    } catch (error) {
      console.warn("[sources] Elastic read failed; trying Mongo:", (error as Error).message);
    }
  }

  const db = await getDb();

  // Build query. For group sessions, drop the userId filter so every
  // member's sources show up in the shared workspace.
  let query: any;
  if (sessionId) {
    const scoped = await sessionScopedFilter(userId, sessionId);
    if (!scoped) return NextResponse.json([]);
    query = { ...scoped };
  } else {
    query = { userId };
  }
  if (kind) query.kind = kind;
  if (activeOnly) query.active = true;
  if (search) query.$text = { $search: search };

  const sources = await db
    .collection("sources")
    .find(query)
    .sort(search ? { score: { $meta: "textScore" } } : { createdAt: -1 })
    .toArray();

  return NextResponse.json(sources);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const body = await req.json();
  const now = new Date();

  const source = {
    userId,
    sessionId: body.sessionId ? new ObjectId(body.sessionId) : null,
    kind: body.kind,
    title: body.title,
    url: body.url ?? null,
    content: body.content ?? null,
    extractedText: body.extractedText ?? null,
    badge: body.badge ?? null,
    active: true,
    metadata: {
      wordCount: body.content ? body.content.split(/\s+/).length : 0,
      language: body.language ?? "en",
      duration: body.duration ?? null,
      pageCount: body.pageCount ?? null,
      thumbnailUrl: body.thumbnailUrl ?? null,
    },
    embedding: null, // Will be populated by embedding pipeline
    createdAt: now,
  };

  const result = await db.collection("sources").insertOne(source);

  embedSourceFireAndForget(
    result.insertedId,
    source.extractedText || source.content || "",
    source.title,
    { userId, sessionId: source.sessionId?.toString() ?? null, kind: source.kind }
  );

  // If linked to a session, add to session's sourceIds array atomically
  if (source.sessionId) {
    await db.collection("sessions").updateOne(
      { _id: source.sessionId, userId },
      {
        $addToSet: { sourceIds: result.insertedId },
        $set: { updatedAt: now },
        $inc: { "metadata.tabCount": 1 },
      }
    );
  }

  await trackEvent(userId, "source_added", {
    sourceId: result.insertedId.toString(),
    kind: source.kind,
    title: source.title,
  });

  return NextResponse.json(
    { _id: result.insertedId, ...source },
    { status: 201 }
  );
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Source ID required" }, { status: 400 });
  }

  if (elasticPrimary()) {
    try {
      const removed = await deleteElasticSource({ userId, sourceId: id });
      if (removed > 0) {
        return NextResponse.json({ success: true, removedChunks: removed });
      }
    } catch (error) {
      console.warn("[sources] Elastic delete failed; trying Mongo:", (error as Error).message);
    }
  }

  const db = await getDb();

  // Load source to figure out whether access is direct (userId) or via a
  // group (shared session). Group members can deactivate any source in the
  // shared workspace.
  const src = await db.collection("sources").findOne({ _id: new ObjectId(id) });
  if (!src) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  let allowed = src.userId === userId;
  if (!allowed && src.sessionId) {
    const scoped = await sessionScopedFilter(userId, String(src.sessionId));
    allowed = !!scoped;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Soft delete: toggle active flag
  const result = await db.collection("sources").findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { active: false } },
    { returnDocument: "after" }
  );

  if (!result) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Source ID required" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  if (elasticPrimary() && typeof body.active === "boolean") {
    try {
      const updated = await setElasticSourceActive({
        userId,
        sourceId: id,
        active: body.active,
      });
      if (updated > 0) return NextResponse.json({ success: true, updated });
    } catch (error) {
      console.warn("[sources] Elastic patch failed; trying Mongo:", (error as Error).message);
    }
  }

  const db = await getDb();

  const src = await db.collection("sources").findOne({ _id: new ObjectId(id) });
  if (!src || src.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const patch: Record<string, any> = {};
  if (typeof body.saved === "boolean") patch.saved = body.saved;

  await db.collection("sources").updateOne({ _id: new ObjectId(id) }, { $set: patch });
  return NextResponse.json({ success: true });
}
