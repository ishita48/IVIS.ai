/**
 * LENS Saved Sessions — the event log, read back.
 * ─────────────────────────────────────────────────────────────────────
 *
 * There is no `saved_sessions` collection and no snapshot document. A saved
 * session IS its rows in the event log, replayed. That is deliberate:
 *
 *   - A snapshot can disagree with what happened. A replay cannot.
 *   - Everything the tutor decided is already being written (ENGINEERING.md
 *     rule 5). Storing it twice would be the counter that rule 4 forbids.
 *   - It means "save" costs one event, not a serialization format to keep in
 *     sync every time the agent gains a tool.
 *
 * The only thing a save writes is the title. Everything else on screen when
 * you reopen a session was recorded as it happened.
 *
 * Storage: Elastic is primary here, not a preference. Mongo's SRV lookup is
 * the thing that fails first on venue Wi-Fi, and when it does the events
 * route already falls back to a UUID session id that has no Mongo document
 * behind it. Reading sessions out of the event log means saved sessions keep
 * working in exactly the conditions where a sessions table would not. The
 * Mongo path below is the fallback, not the other way around.
 */

import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import { EVENTS } from "./events";
import {
  aggregateElasticSessions,
  elasticPrimary,
  queryElasticEvents,
} from "./elastic";
import type {
  LensEvent,
  LoadedLiveSession,
  SavedLiveSession,
} from "./lens/contracts";

/** Event types that mean the student actually did something in here. */
const SUBSTANTIVE = new Set([
  "voice_turn",
  "camera_frame_analyzed",
  "prediction",
  "understanding_noted",
  "misconception_noted",
]);

const iso = (value: unknown): string => {
  const date = new Date(typeof value === "number" ? value : String(value ?? ""));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
};

const ms = (value: unknown): number => new Date(iso(value)).getTime();

/**
 * A name for a session nobody named. Prefers what the student said first —
 * "I'm stuck on this gear train" is a better row in a list than a timestamp —
 * then what LENS decided it was about, then the date.
 */
export function deriveTitle(events: LensEvent[]): string {
  const firstStudentTurn = events.find(
    (e) => e.type === "voice_turn" && (e.payload as any)?.role === "user"
  );
  const said = String((firstStudentTurn?.payload as any)?.text || "").trim();
  if (said.length > 3) {
    return said.length > 60 ? `${said.slice(0, 57).trimEnd()}…` : said;
  }

  const topic = events.find((e) => e.type === "understanding_noted");
  const label = String((topic?.payload as any)?.topic || "").trim();
  if (label) return label;

  const first = events[0];
  if (first) {
    return `Session · ${new Date(first.timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  return "Untitled session";
}

// ── Listing ───────────────────────────────────────────────────────────

export async function listLiveSessions(
  userId: string,
  limit = 50
): Promise<SavedLiveSession[]> {
  if (elasticPrimary()) {
    try {
      const buckets = await aggregateElasticSessions({ userId, limit });
      if (buckets) {
        // Titles and final understanding levels in two more round trips
        // total, not two per session.
        const [titles, levels] = await Promise.all([
          queryElasticEvents<LensEvent>({
            userId,
            types: ["session_saved"],
            limit: 500,
            ascending: true,
          }),
          queryElasticEvents<LensEvent>({
            userId,
            types: ["understanding_noted"],
            limit: 1000,
            ascending: true,
          }),
        ]);

        // Ascending order means the last write for a session wins.
        const titleBySession = new Map<string, string>();
        for (const event of titles ?? []) {
          const title = String((event.payload as any)?.title || "").trim();
          if (title) titleBySession.set(String(event.sessionId), title);
        }

        const levelBySession = new Map<string, number>();
        for (const event of levels ?? []) {
          const level = Number((event.payload as any)?.level);
          if (Number.isFinite(level)) levelBySession.set(String(event.sessionId), level);
        }

        return buckets
          .filter((bucket) =>
            Object.keys(bucket.byType).some((type) => SUBSTANTIVE.has(type))
          )
          .map((bucket) => ({
            sessionId: bucket.sessionId,
            title:
              titleBySession.get(bucket.sessionId) ||
              `Session · ${new Date(bucket.firstAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`,
            saved: titleBySession.has(bucket.sessionId),
            startedAt: iso(bucket.firstAt),
            endedAt: iso(bucket.lastAt),
            eventCount: bucket.eventCount,
            looks: bucket.byType.camera_frame_analyzed ?? 0,
            voiceTurns: bucket.byType.voice_turn ?? 0,
            predictions: bucket.byType.prediction ?? 0,
            notes: bucket.byType.understanding_noted ?? 0,
            misconceptions: bucket.byType.misconception_noted ?? 0,
            finalUnderstanding: levelBySession.get(bucket.sessionId) ?? null,
          }));
      }
    } catch (error) {
      console.warn(
        "[live-sessions] Elastic list failed, falling back to Mongo:",
        (error as Error).message
      );
    }
  }

  return listFromMongo(userId, limit);
}

async function listFromMongo(userId: string, limit: number): Promise<SavedLiveSession[]> {
  const db = await getDb();
  const rows = await db
    .collection(EVENTS)
    .aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: "$sessionId",
          eventCount: { $sum: 1 },
          startedAt: { $min: "$timestamp" },
          endedAt: { $max: "$timestamp" },
          types: { $push: "$type" },
          title: {
            $last: {
              $cond: [{ $eq: ["$type", "session_saved"] }, "$payload.title", null],
            },
          },
          level: {
            $last: {
              $cond: [
                { $eq: ["$type", "understanding_noted"] },
                "$payload.level",
                null,
              ],
            },
          },
        },
      },
      { $sort: { endedAt: -1 } },
      { $limit: limit },
    ])
    .toArray();

  return rows
    .filter((row: any) => (row.types as string[]).some((t) => SUBSTANTIVE.has(t)))
    .map((row: any) => {
      const count = (type: string) =>
        (row.types as string[]).filter((t) => t === type).length;
      return {
        sessionId: String(row._id),
        title:
          row.title ||
          `Session · ${new Date(row.startedAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}`,
        saved: !!row.title,
        startedAt: iso(row.startedAt),
        endedAt: iso(row.endedAt),
        eventCount: row.eventCount,
        looks: count("camera_frame_analyzed"),
        voiceTurns: count("voice_turn"),
        predictions: count("prediction"),
        notes: count("understanding_noted"),
        misconceptions: count("misconception_noted"),
        finalUnderstanding: Number.isFinite(Number(row.level))
          ? Number(row.level)
          : null,
      };
    });
}

// ── Loading one ───────────────────────────────────────────────────────

/**
 * Rebuild everything the summary needs. Returns null when the session has
 * no events belonging to this user — which is also the answer for a
 * sessionId that belongs to someone else, so a guessed id reveals nothing.
 */
export async function loadLiveSession(
  userId: string,
  sessionId: string
): Promise<LoadedLiveSession | null> {
  const events = await eventsForSession(userId, sessionId);
  if (!events.length) return null;

  const payloads = <T,>(type: string, map: (p: any, e: LensEvent) => T): T[] =>
    events.filter((e) => e.type === type).map((e) => map(e.payload as any, e));

  const transcript = payloads("voice_turn", (p, e) => ({
    role: p?.role === "user" ? ("user" as const) : ("agent" as const),
    text: String(p?.text ?? ""),
    at: Number(p?.at) || ms(e.timestamp),
  })).filter((entry) => entry.text.trim().length > 0);

  const understanding = payloads("understanding_noted", (p, e) => ({
    topic: String(p?.topic ?? ""),
    level: Math.min(1, Math.max(0, Number(p?.level) || 0)),
    why: String(p?.why ?? ""),
    at: ms(e.timestamp),
  }));

  const beliefs = payloads("misconception_noted", (p, e) => ({
    belief: String(p?.belief ?? ""),
    rootCause: String(p?.rootCause ?? ""),
    practice: String(p?.practice ?? ""),
    at: ms(e.timestamp),
  })).filter((b) => b.belief.trim().length > 0);

  const predictionTexts = payloads("prediction", (p, e) => ({
    text: String(p?.answer ?? p?.value ?? ""),
    at: ms(e.timestamp),
  })).filter((p) => p.text.trim().length > 0);

  const observations = payloads("camera_frame_analyzed", (p, e) => ({
    observation: String(p?.observation ?? ""),
    confidence: Number(p?.confidence) || 0,
    at: ms(e.timestamp),
  }));

  const savedTitle = events
    .filter((e) => e.type === "session_saved")
    .map((e) => String((e.payload as any)?.title || "").trim())
    .filter(Boolean)
    .pop();

  return {
    sessionId,
    title: savedTitle || deriveTitle(events),
    saved: !!savedTitle,
    startedAt: iso(events[0].timestamp),
    endedAt: iso(events[events.length - 1].timestamp),
    eventCount: events.length,
    looks: observations.length,
    voiceTurns: transcript.length,
    predictions: predictionTexts.length,
    notes: understanding.length,
    misconceptions: beliefs.length,
    finalUnderstanding: understanding.length
      ? understanding[understanding.length - 1].level
      : null,
    transcript,
    understanding,
    beliefs,
    predictionTexts,
    observations,
  };
}

async function eventsForSession(
  userId: string,
  sessionId: string
): Promise<LensEvent[]> {
  if (elasticPrimary()) {
    try {
      const rows = await queryElasticEvents<LensEvent>({
        userId,
        sessionId,
        limit: 1000,
        ascending: true,
      });
      if (rows) return rows;
    } catch (error) {
      console.warn(
        "[live-sessions] Elastic read failed, falling back to Mongo:",
        (error as Error).message
      );
    }
  }

  const db = await getDb();
  // Mongo stores sessionId as an ObjectId when it could mint one, and as the
  // raw string when it fell back to a UUID. Match either.
  const ids: unknown[] = [sessionId];
  if (ObjectId.isValid(sessionId)) ids.push(new ObjectId(sessionId));

  const rows = await db
    .collection(EVENTS)
    .find({ userId, sessionId: { $in: ids } as any })
    .sort({ timestamp: 1 })
    .limit(1000)
    .toArray();

  return rows.map((r: any) => ({
    _id: r._id?.toString(),
    sessionId: r.sessionId?.toString(),
    userId: r.userId,
    type: r.type,
    concept: r.concept ?? null,
    payload: r.payload ?? {},
    timestamp: iso(r.timestamp),
  }));
}

/** The title a session gets when the student saves it without naming it. */
export async function suggestTitle(
  userId: string,
  sessionId: string
): Promise<string> {
  const events = await eventsForSession(userId, sessionId);
  return deriveTitle(events);
}
