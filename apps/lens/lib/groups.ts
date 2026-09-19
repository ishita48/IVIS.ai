/**
 * Group / shared-session access control helpers.
 * ────────────────────────────────────────────────────────────────────
 * The app's sessions were originally single-user: every content query
 * filtered by both `userId` and `sessionId`. To support multi-user group
 * sessions we need a second access path — a user can read/write a session
 * when either:
 *   (a) they own it (session.userId === userId), or
 *   (b) they are a member of the group the session is linked to.
 *
 * Routes use `assertSessionAccess` first, then drop the `userId` filter
 * from their Mongo query in favour of filtering by `sessionId` alone.
 * Writes still record `userId: callerId` for attribution.
 */

import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";

export type SessionAccess = {
  session: any;
  /** True when the session is group-owned and the caller is a member. */
  isGroupMember: boolean;
  /** The owning clerkId for the session (for impersonation on writes). */
  ownerUserId: string;
};

/**
 * Returns access info if the user can act on this session, otherwise null.
 * Does NOT throw — the caller decides the response code.
 */
export async function assertSessionAccess(
  userId: string,
  sessionId: string
): Promise<SessionAccess | null> {
  if (!sessionId || !ObjectId.isValid(sessionId)) return null;

  const db = await getDb();
  const session = await db.collection("sessions").findOne({
    _id: new ObjectId(sessionId),
  });
  if (!session) return null;

  // (a) Personal session — direct ownership.
  if (session.userId === userId) {
    return { session, isGroupMember: false, ownerUserId: userId };
  }

  // (b) Group session — check membership.
  if (session.groupId) {
    const group = await db.collection("groups").findOne({
      _id: new ObjectId(String(session.groupId)),
      "members.clerkId": userId,
    });
    if (group) {
      return {
        session,
        isGroupMember: true,
        ownerUserId: String(session.userId),
      };
    }
  }

  return null;
}

/**
 * Like `assertSessionAccess` but returns all session IDs the user can read
 * across their own sessions AND sessions of groups they belong to.
 * Used for sidebar list queries that don't target a specific session.
 */
export async function userAccessibleSessionIds(
  userId: string
): Promise<ObjectId[]> {
  const db = await getDb();

  const [owned, groupIds] = await Promise.all([
    db
      .collection("sessions")
      .find({ userId }, { projection: { _id: 1 } })
      .toArray(),
    db
      .collection("groups")
      .find(
        { "members.clerkId": userId },
        { projection: { sessionId: 1 } }
      )
      .toArray(),
  ]);

  const ids = new Set<string>();
  for (const s of owned) ids.add(String(s._id));
  for (const g of groupIds) if (g.sessionId) ids.add(String(g.sessionId));
  return Array.from(ids).map((id) => new ObjectId(id));
}

/**
 * Short, URL-safe random code for group invite links.
 * 8 chars from a base-32-ish alphabet → ~40 bits of entropy, enough for
 * non-guessable casual sharing.
 */
export function generateShareCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

/**
 * Builds the Mongo filter for a content query (sources / flashcards / chat
 * messages / etc.) that respects group semantics:
 *   - Personal session → { userId, sessionId }  (legacy behaviour)
 *   - Group session   → { sessionId }           (all members see all rows)
 *
 * Returns null if the caller has no access to the session at all, in which
 * case the route should 403.
 */
export async function sessionScopedFilter(
  userId: string,
  sessionId: string
): Promise<{ userId?: string; sessionId: ObjectId } | null> {
  if (!sessionId || !ObjectId.isValid(sessionId)) return null;

  const db = await getDb();
  const session = await db
    .collection("sessions")
    .findOne({ _id: new ObjectId(sessionId) });
  if (!session) return null;

  // Group session — verify membership then return a group-wide filter.
  if (session.groupId) {
    const group = await db.collection("groups").findOne({
      _id: new ObjectId(String(session.groupId)),
      "members.clerkId": userId,
    });
    if (!group) return null;
    return { sessionId: new ObjectId(sessionId) };
  }

  // Personal session — must be owned by caller.
  if (session.userId !== userId) return null;
  return { userId, sessionId: new ObjectId(sessionId) };
}
