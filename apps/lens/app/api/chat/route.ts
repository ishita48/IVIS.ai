import { auth } from "@clerk/nextjs/server";
import { getDb } from "@/lib/mongodb";
import { trackEvent } from "@/lib/aggregations";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { sessionScopedFilter } from "@/lib/groups";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const scoped = await sessionScopedFilter(userId, sessionId);
  if (!scoped) return NextResponse.json([]);

  // Uses compound index: { sessionId: 1, createdAt: 1 }
  const messages = await db
    .collection("chat_messages")
    .find(scoped)
    .sort({ createdAt: 1 })
    .toArray();

  return NextResponse.json(messages);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const body = await req.json();

  // Verify the caller can write to this session (owner or group member).
  const scoped = await sessionScopedFilter(userId, body.sessionId);
  if (!scoped) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();

  const message = {
    userId,
    sessionId: new ObjectId(body.sessionId),
    role: body.role,
    text: body.text,
    chips: body.chips ?? null,
    sources: body.sources ?? null,
    createdAt: now,
  };

  const result = await db.collection("chat_messages").insertOne(message);

  // Update session's updatedAt. We've already verified access above, so
  // filter by _id only (group members need to be able to bump the timestamp).
  await db.collection("sessions").updateOne(
    { _id: new ObjectId(body.sessionId) },
    { $set: { updatedAt: now } }
  );

  // Track for analytics
  if (body.role === "user") {
    await trackEvent(userId, "chat_message_sent", {
      sessionId: body.sessionId,
      length: body.text.length,
    });
  }

  return NextResponse.json({ _id: result.insertedId, ...message }, { status: 201 });
}
