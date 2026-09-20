import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/mongodb";
import { trackEvent } from "@/lib/aggregations";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { sessionScopedFilter } from "@/lib/groups";
import { elasticPrimary, indexElasticDocument, searchElasticDocuments, updateElasticDoc } from "@/lib/elastic";

function serializeChatMessage(r: any) {
  return { ...r, _id: r._id?.toString?.() ?? r._id, sessionId: r.sessionId?.toString?.() ?? r.sessionId };
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const scoped = await sessionScopedFilter(userId, sessionId);
  if (!scoped) return NextResponse.json([]);

  if (elasticPrimary()) {
    try {
      const rows = await searchElasticDocuments<any>("chatMessages", sessionId, 500, true);
      if (rows) return NextResponse.json(rows.map(serializeChatMessage));
    } catch (error) {
      console.warn("[chat] Elastic read failed, falling back to Mongo:", (error as Error).message);
    }
  }

  if (!ObjectId.isValid(sessionId)) return NextResponse.json([]);
  const db = await getDb();
  // Uses compound index: { sessionId: 1, createdAt: 1 }
  const messages = await db
    .collection("chat_messages")
    .find(scoped as any)
    .sort({ createdAt: 1 })
    .toArray();

  return NextResponse.json(messages.map(serializeChatMessage));
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const sessionId = String(body.sessionId ?? "");

  // Verify the caller can write to this session (owner or group member).
  const scoped = await sessionScopedFilter(userId, sessionId);
  if (!scoped) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const message = {
    userId,
    sessionId,
    role: body.role,
    text: body.text,
    chips: body.chips ?? null,
    sources: body.sources ?? null,
    createdAt: now.toISOString(),
  };

  let id: string | null = null;

  if (elasticPrimary()) {
    try {
      id = crypto.randomUUID();
      await indexElasticDocument("chatMessages", id, message);
      // Best-effort: group members bumping the timestamp isn't worth
      // failing the message write over.
      await updateElasticDoc("sessions", sessionId, { updatedAt: message.createdAt }).catch(() => undefined);
    } catch (error) {
      console.warn("[chat] Elastic write failed, falling back to Mongo:", (error as Error).message);
      id = null;
    }
  }

  if (id === null) {
    if (!ObjectId.isValid(sessionId)) {
      return NextResponse.json({ error: "Chat storage is unavailable for this session" }, { status: 500 });
    }
    const db = await getDb();
    const result = await db.collection("chat_messages").insertOne({
      ...message,
      sessionId: new ObjectId(sessionId),
      createdAt: now,
    });
    // Filter by _id only (group members need to be able to bump the timestamp).
    await db.collection("sessions").updateOne(
      { _id: new ObjectId(sessionId) },
      { $set: { updatedAt: now } }
    );
    id = result.insertedId.toString();
  }

  // Track for analytics
  if (body.role === "user") {
    await trackEvent(userId, "chat_message_sent", {
      sessionId,
      length: body.text.length,
    });
  }

  return NextResponse.json({ _id: id, ...message }, { status: 201 });
}
