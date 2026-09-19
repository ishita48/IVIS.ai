/**
 * Lightweight analytics + global search.
 * ─────────────────────────────────────────────────────────────────────
 * Trimmed to what LENS actually uses. The flashcard/quiz dashboards went
 * out with those features. Demo-facing numbers do NOT come from here —
 * they come from lib/metrics.ts, computed off the real events collection.
 */

import { getDb } from "./mongodb";

/** Fire-and-forget usage tracking. Never throws into a request path. */
export async function trackEvent(
  userId: string,
  event: string,
  metadata: Record<string, any> = {}
) {
  try {
    const db = await getDb();
    await db.collection("analytics_events").insertOne({
      userId,
      event,
      metadata,
      createdAt: new Date(),
    });
  } catch {
    /* analytics must never break a user action */
  }
}

/** Text search across the student's sessions and sources. */
export async function globalSearch(userId: string, query: string) {
  const db = await getDb();
  const rx = new RegExp(escapeRegex(query), "i");

  const [sessions, sources] = await Promise.all([
    db
      .collection("sessions")
      .find({ userId, status: "active", title: rx })
      .project({ _id: 1, title: 1, updatedAt: 1 })
      .limit(10)
      .toArray(),
    db
      .collection("sources")
      .find({ userId, $or: [{ title: rx }, { extractedText: rx }] })
      .project({ _id: 1, title: 1, kind: 1, sessionId: 1, url: 1 })
      .limit(20)
      .toArray(),
  ]);

  return {
    sessions: sessions.map((s: any) => ({ ...s, _id: String(s._id) })),
    sources: sources.map((s: any) => ({
      ...s,
      _id: String(s._id),
      sessionId: s.sessionId ? String(s.sessionId) : null,
    })),
  };
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
