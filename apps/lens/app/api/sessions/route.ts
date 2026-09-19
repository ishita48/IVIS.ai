import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/mongodb";
import { trackEvent } from "@/lib/aggregations";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "active";
  const search = searchParams.get("q");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 50);
  const skip = parseInt(searchParams.get("skip") ?? "0");

  // Personal sidebar must never include group sessions — those are
  // listed under the "Groups" section and have their own UI.
  let query: any = { userId, status, groupId: { $exists: false } };

  // Use text index for search queries
  if (search) {
    query.$text = { $search: search };
  }

  // Uses compound index: { userId: 1, status: 1 } and { userId: 1, updatedAt: -1 }
  let sessions: any[];
  if (!search && status === "active") {
    // Hide empty placeholder sessions (no messages, no sources, default title).
    // A session "earns" a row in the sidebar only after the user does something:
    // sends a message, adds a source, or renames the chat.
    // All titles that `resolveOrCreateSession` (session-helpers.ts) or the
    // client's newSession() can produce for a brand-new, untouched session.
    // Sessions with one of these titles AND no messages AND no sources are
    // hidden from the sidebar so they don't flood the history list.
    const DEFAULT_TITLES = [
      "New chat",
      "Study Session",
      "Untitled Session",
      "Untitled session",
    ];
    sessions = await db
      .collection("sessions")
      .aggregate([
        { $match: query },
        { $sort: { updatedAt: -1 } },
        { $skip: skip },
        { $limit: limit + 50 }, // overscan so post-filter still fills the page
        {
          $lookup: {
            from: "chat_messages",
            let: { sid: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$sessionId", "$$sid"] } } },
              { $limit: 1 },
              { $project: { _id: 1 } },
            ],
            as: "_hasMsg",
          },
        },
        {
          $match: {
            $or: [
              { $expr: { $gt: [{ $size: "$_hasMsg" }, 0] } },
              { $expr: { $gt: [{ $size: { $ifNull: ["$sourceIds", []] } }, 0] } },
              { title: { $nin: DEFAULT_TITLES } },
            ],
          },
        },
        { $project: { _hasMsg: 0 } },
        { $limit: limit },
      ])
      .toArray();
  } else {
    sessions = await db
      .collection("sessions")
      .find(query)
      .sort(search ? { score: { $meta: "textScore" } } : { updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  }

  // Get total count for pagination
  const total = await db.collection("sessions").countDocuments(query);

  return NextResponse.json({ sessions, total, limit, skip });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const body = await req.json();
  const now = new Date();

  const session = {
    userId,
    title: body.title ?? "Untitled Session",
    sourceIds: [],
    status: "active",
    metadata: {
      tabCount: body.tabCount ?? 0,
      duration: 0,
      generatedAt: now,
    },
    tags: body.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection("sessions").insertOne(session);

  // Atomically increment user's session count
  await db.collection("users").updateOne(
    { clerkId: userId },
    { $inc: { "stats.totalSessions": 1 } }
  );

  // Track session creation in analytics
  await trackEvent(userId, "session_created", {
    sessionId: result.insertedId.toString(),
    title: session.title,
    tabCount: session.metadata.tabCount,
  });

  return NextResponse.json(
    { _id: result.insertedId, ...session },
    { status: 201 }
  );
}

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const body = await req.json();

  if (!body.id) {
    return NextResponse.json({ error: "Session ID required" }, { status: 400 });
  }

  const updateFields: Record<string, any> = { updatedAt: new Date() };
  if (body.title) updateFields.title = body.title;
  if (body.status) updateFields.status = body.status;
  if (body.tags) updateFields.tags = body.tags;

  // Allow either the owner OR a group member to update a session's title.
  // (Members can rename a group's chat collaboratively.)
  const existing = await db.collection("sessions").findOne({
    _id: new ObjectId(body.id),
  });
  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  let canEdit = existing.userId === userId;
  if (!canEdit && existing.groupId) {
    const inGroup = await db.collection("groups").findOne({
      _id: new ObjectId(String(existing.groupId)),
      "members.clerkId": userId,
    });
    if (inGroup) canEdit = true;
  }
  if (!canEdit) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const result = await db.collection("sessions").findOneAndUpdate(
    { _id: new ObjectId(body.id) },
    { $set: updateFields },
    { returnDocument: "after" }
  );

  // If this session belongs to a group, mirror the title rename to the
  // group document so the sidebar's "Groups" entry updates too.
  if (result && body.title && existing.groupId) {
    await db.collection("groups").updateOne(
      { _id: new ObjectId(String(existing.groupId)) },
      { $set: { name: body.title, updatedAt: new Date() } }
    );
  }

  if (!result) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}

/**
 * DELETE /api/sessions?id=...               → archive a single session (soft delete)
 * DELETE /api/sessions?all=1                → archive ALL active chats for the caller
 * DELETE /api/sessions?all=1&mode=hard      → permanently delete every chat + its
 *                                             content (sources, flashcards, quizzes,
 *                                             summaries, concept-maps, videos, canvases,
 *                                             chat messages). Cannot be undone.
 */
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const all = searchParams.get("all");
  const mode = searchParams.get("mode") ?? "archive";

  const db = await getDb();

  // ── Bulk archive / hard-delete ────────────────────────────────────────
  if (all) {
    if (mode === "hard") {
      // Only target the user's own personal chats. Group sessions are owned
      // by the group and shouldn't be wiped by a personal "delete all".
      const sessions = await db
        .collection("sessions")
        .find({ userId, groupId: { $exists: false } })
        .project({ _id: 1 })
        .toArray();

      const sessionIds = sessions.map((s: any) => s._id);

      if (sessionIds.length) {
        const filter = { sessionId: { $in: sessionIds } };
        await Promise.all([
          db.collection("chat_messages").deleteMany(filter),
          db.collection("sources").deleteMany(filter),
          db.collection("flashcards").deleteMany(filter),
          db.collection("quizzes").deleteMany(filter),
          db.collection("summaries").deleteMany(filter),
          db.collection("concept_maps").deleteMany(filter),
          db.collection("videos").deleteMany(filter),
          db.collection("canvases").deleteMany(filter),
        ]);
        await db.collection("sessions").deleteMany({ _id: { $in: sessionIds } });
      }

      await trackEvent(userId, "sessions_bulk_deleted", { count: sessionIds.length });
      return NextResponse.json({ ok: true, count: sessionIds.length, mode: "hard" });
    }

    // Default: soft archive
    const res = await db.collection("sessions").updateMany(
      { userId, status: "active", groupId: { $exists: false } },
      { $set: { status: "archived", updatedAt: new Date() } }
    );
    await trackEvent(userId, "sessions_bulk_archived", { count: res.modifiedCount });
    return NextResponse.json({ ok: true, count: res.modifiedCount, mode: "archive" });
  }

  // ── Single archive / hard-delete ──────────────────────────────────────
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const oid = new ObjectId(id);

  if (mode === "hard") {
    // Confirm ownership before wiping anything.
    const owned = await db
      .collection("sessions")
      .findOne({ _id: oid, userId, groupId: { $exists: false } }, { projection: { _id: 1 } });
    if (!owned) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const filter = { sessionId: oid };
    await Promise.all([
      db.collection("chat_messages").deleteMany(filter),
      db.collection("sources").deleteMany(filter),
      db.collection("flashcards").deleteMany(filter),
      db.collection("quizzes").deleteMany(filter),
      db.collection("summaries").deleteMany(filter),
      db.collection("concept_maps").deleteMany(filter),
      db.collection("videos").deleteMany(filter),
      db.collection("canvases").deleteMany(filter),
    ]);
    await db.collection("sessions").deleteOne({ _id: oid, userId });

    return NextResponse.json({ ok: true, mode: "hard" });
  }

  const result = await db.collection("sessions").findOneAndUpdate(
    { _id: oid, userId },
    { $set: { status: "archived", updatedAt: new Date() } },
    { returnDocument: "after" }
  );

  if (!result) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
