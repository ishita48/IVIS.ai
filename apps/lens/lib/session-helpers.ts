import { getDb } from "./mongodb";
import { ObjectId } from "mongodb";
import type { SourceForAI } from "./ai";
import { elasticPrimary, indexElasticDocument, queryElasticDocs } from "./elastic";
import { canAccessClass } from "./classroom";

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
/**
 * Resolve a session without Mongo.
 *
 * Sessions are the last thing in the write path that needed a relational
 * store, and needing one meant an Atlas outage took down event recording,
 * the metrics strip and the saved-session list all at once. An Elastic
 * session document is the same three fields, in the store that is already
 * holding everything those features read.
 */
async function resolveOrCreateElasticSession(
  userId: string,
  sessionId?: string | null,
  title = "LENS Session"
) {
  const now = new Date().toISOString();

  if (sessionId) {
    // Owned: the ordinary case, and the filter that closed the
    // cross-account leak. Never widened.
    const owned = await queryElasticDocs<any>("sessions", {
      filter: [{ term: { _id: sessionId } }, { term: { userId } }],
      size: 1,
    }).catch(() => null);
    if (owned?.length) return { _id: sessionId, ...owned[0] };

    // Shared: a circle's group session, which by design several people
    // write to. Fetched by id and then gated on a membership row that this
    // user actually holds — the read is only granted for a session that
    // carries a classId, and only to a member of that class. A private
    // session has no classId, so this path can never reach one.
    const shared = await queryElasticDocs<any>("sessions", {
      filter: [{ term: { _id: sessionId } }, { term: { shared: true } }],
      size: 1,
    }).catch(() => null);
    const doc = shared?.[0];
    if (doc?.classId && (await canAccessClass(String(doc.classId), userId))) {
      return { _id: sessionId, ...doc };
    }
  }

  // A requested id that we could not read is either someone else's session
  // or one we are not a member of. Reusing it here would index a new
  // document at that id and OVERWRITE theirs, handing the caller both the
  // id and ownership — a takeover of any session whose id could be
  // guessed, which is strictly worse than the read leak it looks like.
  // Only reuse an id that resolves to nothing at all.
  let id = sessionId || crypto.randomUUID();
  if (sessionId) {
    const taken = await queryElasticDocs<any>("sessions", {
      filter: [{ term: { _id: sessionId } }],
      size: 1,
    }).catch(() => null);
    if (taken?.length) id = crypto.randomUUID();
  }

  const doc = {
    userId,
    title,
    surface: "lens",
    sourceIds: [] as string[],
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await indexElasticDocument("sessions", id, doc);
  return { _id: id, ...doc };
}

export async function resolveOrCreateSession(
  userId: string,
  sessionId?: string | null,
  title = "Study Session"
) {
  // Elastic first when it is primary. Mongo is only consulted if Elastic
  // is not configured, or if the Elastic write itself fails.
  if (elasticPrimary()) {
    try {
      return await resolveOrCreateElasticSession(userId, sessionId, title);
    } catch (error) {
      console.warn(
        "[session-helpers] Elastic session failed, trying Mongo:",
        (error as Error).message
      );
    }
  }

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
