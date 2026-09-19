import { getDb } from "./mongodb";
import { ObjectId } from "mongodb";
import type { SourceForAI } from "./ai";

/**
 * Resolve a session by id if provided & accessible (owned OR group-membership),
 * else create a brand-new session for the user. Always returns a doc.
 *
 * NOTE: We intentionally do NOT fall back to the user's "most recent" session
 * when no sessionId is provided — that caused sources to be silently routed
 * into the wrong session (e.g. a group upload landing in a personal chat when
 * bootstrap hadn't finished yet). With the lazy "virtual new chat" UX, a
 * missing sessionId means "create a brand-new session right now".
 */
export async function resolveOrCreateSession(
  userId: string,
  sessionId?: string | null,
  title = "Study Session"
) {
  const db = await getDb();
  const now = new Date();

  if (sessionId && ObjectId.isValid(sessionId)) {
    const existing = await db.collection("sessions").findOne({
      _id: new ObjectId(sessionId),
    });
    if (existing) {
      // Direct owner
      if (existing.userId === userId) return existing;
      // Group member access
      if (existing.groupId) {
        const inGroup = await db.collection("groups").findOne({
          _id: new ObjectId(String(existing.groupId)),
          "members.clerkId": userId,
        });
        if (inGroup) return existing;
      }
      // Not accessible — fall through and create a brand-new session
      // rather than silently writing into the wrong chat.
    }
  }

  const doc = {
    userId,
    title,
    sourceIds: [],
    status: "active",
    metadata: { tabCount: 0, duration: 0, generatedAt: now },
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  const res = await db.collection("sessions").insertOne(doc as any);
  return { _id: res.insertedId, ...doc };
}

/**
 * Load active sources for a given session. If the session is group-owned, the
 * `userId` filter is dropped (sources from every member are returned).
 */
export async function loadActiveSources(
  userId: string,
  sessionId?: string | null
): Promise<SourceForAI[]> {
  const db = await getDb();
  const query: any = { active: true };

  // Determine whether this is a group session (→ group-wide query) or a
  // personal session (→ user-scoped query).
  let isGroupSession = false;
  if (sessionId && ObjectId.isValid(sessionId)) {
    const session = await db
      .collection("sessions")
      .findOne({ _id: new ObjectId(sessionId) });
    if (session?.groupId) isGroupSession = true;
    query.sessionId = new ObjectId(sessionId);
  }

  if (!isGroupSession) query.userId = userId;

  const rows = await db
    .collection("sources")
    .find(query)
    .sort({ createdAt: 1 })
    .toArray();

  return rows.map((r: any) => ({
    _id: r._id.toString(),
    title: r.title,
    kind: r.kind,
    extractedText: r.extractedText ?? null,
    content: r.content ?? null,
    url: r.url ?? null,
  }));
}
