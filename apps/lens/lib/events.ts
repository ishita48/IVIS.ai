/**
 * LENS Events — the single source of truth for what the student did.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 4 (Integrations & Infra).
 *
 * Everything downstream is derived from this collection: the reasoning
 * engine's evidence, the reasoning graph UI, and every number in the
 * metrics strip. Nothing in the demo is computed from a counter held in
 * React state — if it is on screen, it came from a row in here.
 */

import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import {
  elasticPrimary,
  indexElasticDocument,
  searchElasticDocuments,
} from "./elastic";
import { eventLabel, type LensEvent, type LensEventType } from "./lens/contracts";
import { LEDGER_EVENT_TYPES } from "./token-ledger";

export const EVENTS = "events";

export type RecordEventInput = {
  sessionId: string;
  userId: string;
  type: LensEventType;
  concept?: string | null;
  payload?: Record<string, unknown>;
};

export async function recordEvent(input: RecordEventInput): Promise<string> {
  const id = crypto.randomUUID();
  const doc = {
    sessionId: input.sessionId,
    userId: input.userId,
    type: input.type,
    concept: input.concept ?? null,
    payload: input.payload ?? {},
    timestamp: new Date(),
  };
  if (elasticPrimary()) {
    try {
      await indexElasticDocument("events", id, doc);
      return id;
    } catch (error) {
      console.warn("[events] Elastic write failed, falling back to Mongo:", (error as Error).message);
    }
  }
  const db = await getDb();
  const res = await db.collection(EVENTS).insertOne({ ...doc, sessionId: new ObjectId(input.sessionId) } as any);
  return res.insertedId.toString();
}

/**
 * The student's actions, oldest first. Token-ledger rows live in the same
 * collection but are not evidence, so they are left out here.
 */
export async function recentEvents(
  sessionId: string,
  limit = 40,
  type?: LensEventType
): Promise<LensEvent[]> {
  if (elasticPrimary()) {
    try {
      const rows = await searchElasticDocuments<LensEvent>("events", sessionId, limit, false, type);
      if (rows) {
        return rows
          .filter((r) => !LEDGER_EVENT_TYPES.includes(r.type))
          .reverse()
          .map(serializeEvent);
      }
    } catch (error) {
      console.warn("[events] Elastic read failed, falling back to Mongo:", (error as Error).message);
    }
  }
  if (!ObjectId.isValid(sessionId)) return [];
  const db = await getDb();
  const rows = await db
    .collection(EVENTS)
    .find({
      sessionId: new ObjectId(sessionId),
      ...(type ? { type } : { type: { $nin: LEDGER_EVENT_TYPES } }),
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  // Oldest → newest, so the model reads the session as a narrative.
  return rows.reverse().map(serializeEvent);
}

export function serializeEvent(r: any): LensEvent {
  return {
    _id: r._id?.toString(),
    sessionId: r.sessionId?.toString(),
    userId: r.userId,
    type: r.type,
    concept: r.concept ?? null,
    payload: r.payload ?? {},
    timestamp: new Date(r.timestamp).toISOString(),
  };
}

/**
 * Compact, human-readable rendering of the event log for the reasoning
 * prompt. Keeping this in one place means the prompt and the timeline UI
 * describe the same history in the same words.
 */
export function eventsToTranscript(events: LensEvent[]): string {
  if (!events.length) return "(no events recorded yet)";
  return events
    .map((e, i) => {
      const p = e.payload as any;
      const at = `#${i + 1} [${eventLabel(e)}${e.concept ? ` · ${e.concept}` : ""}]`;
      switch (e.type) {
        case "camera_frame_analyzed":
          return `${at} observed: ${p.observation ?? "(none)"} (confidence ${p.confidence ?? "?"})`;
        case "prediction":
          return `${at} student predicted: "${p.answer ?? p.value ?? "?"}" to "${p.question ?? "?"}"`;
        case "understanding_check_answered":
          return `${at} understanding check "${p.question ?? "?"}" answered "${p.answer ?? "?"}" — ${p.correct ? "CORRECT" : "INCORRECT"}`;
        case "pointer_used":
          return `${at} LENS pointed at "${p.label ?? "target"}" for question "${p.question ?? "?"}"`;
        case "hint_requested":
          return `${at} hint escalated to level ${p.level ?? "?"}`;
        case "experiment_started":
          return `${at} experiment started: ${p.hypothesis ?? "?"}`;
        case "experiment_completed":
          return `${at} experiment outcome: ${p.actualOutcome ?? "?"} (student predicted: ${p.studentPrediction ?? "?"})`;
        case "retry":
          return `${at} student retried after ${p.reason ?? "a failed attempt"}`;
        case "source_opened":
          return `${at} opened source "${p.title ?? "?"}"`;
        case "understanding_noted":
          return `${at} LENS read understanding of "${p.topic ?? "?"}" at ${Math.round(Number(p.level ?? 0) * 100)}% — ${p.why ?? "no evidence given"}`;
        case "misconception_noted":
          return `${at} LENS named a belief: "${p.belief ?? "?"}" (actually: ${p.rootCause ?? "?"})`;
        case "session_saved":
          return `${at} student saved this session as "${p.title ?? "?"}"`;
        default:
          return `${at} ${JSON.stringify(p).slice(0, 160)}`;
      }
    })
    .join("\n");
}
