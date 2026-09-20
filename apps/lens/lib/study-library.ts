/**
 * LENS Study Library — saved flashcards and saved quiz questions.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Same arrangement as saved sessions (lib/live-sessions.ts): there is no
 * library collection. A saved item is a `*_saved` event, an un-save is a
 * `*_unsaved` event, and the library is those events replayed — last write
 * per item wins. Attempts are their own events, so an item's difficulty
 * history is a query, never a counter someone remembered to increment.
 *
 * Cards and questions share this file rather than having one each: they
 * differ only in their event names and their payload shape, and a second
 * near-identical module is how the two drift apart by hour thirty.
 *
 * Two things fall out of the design which are worth having:
 *
 *   - Item ids are a hash of the text, so regenerating from the same
 *     material produces the same ids, and a question you got wrong last
 *     time is still the question you got wrong. Nothing has to be stable
 *     on the server for that to hold.
 *   - Elastic is primary, which matters here specifically: Mongo's SRV
 *     lookup is the first thing to die on venue Wi-Fi, and a library that
 *     needed it would be empty exactly when it is being demoed.
 */

import { elasticPrimary, queryElasticEvents } from "./elastic";
import { getDb } from "./mongodb";
import { EVENTS } from "./events";
import type {
  CardGrade,
  Flashcard,
  LensEvent,
  LensEventType,
  LibraryKind,
  QuizQuestion,
  SavedFlashcard,
  SavedQuizQuestion,
} from "./lens/contracts";

/** The three event names each kind uses. */
const EVENTS_FOR: Record<
  LibraryKind,
  { saved: LensEventType; unsaved: LensEventType; attempted: LensEventType }
> = {
  card: {
    saved: "flashcard_saved",
    unsaved: "flashcard_unsaved",
    attempted: "flashcard_reviewed",
  },
  question: {
    saved: "quiz_saved",
    unsaved: "quiz_unsaved",
    attempted: "quiz_answered",
  },
};

/**
 * FNV-1a over the normalized text.
 *
 * Deliberately not crypto: this runs on both sides of the wire, needs no
 * import, and the only property required is that the same text maps to the
 * same short id. Collisions between two genuinely different items are
 * possible in theory and harmless in practice — the worst case is two
 * items sharing a history.
 */
export function itemId(...parts: string[]): string {
  const input = parts.join("\u0000").toLowerCase().replace(/\s+/g, " ").trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `i${h1.toString(36)}${h2.toString(36)}`;
}

const iso = (value: unknown): string => {
  const d = new Date(typeof value === "number" ? value : String(value ?? ""));
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
};

const asGrade = (value: unknown): CardGrade | null =>
  value === "known" || value === "partial" || value === "unknown" ? value : null;

async function libraryEvents(
  userId: string,
  kind: LibraryKind
): Promise<LensEvent[]> {
  const names = EVENTS_FOR[kind];
  const types = [names.saved, names.unsaved, names.attempted];

  if (elasticPrimary()) {
    try {
      const rows = await queryElasticEvents<LensEvent>({
        userId,
        types,
        limit: 2000,
        ascending: true,
      });
      if (rows) return rows;
    } catch (error) {
      console.warn(
        "[study-library] Elastic read failed, falling back to Mongo:",
        (error as Error).message
      );
    }
  }

  const db = await getDb();
  const rows = await db
    .collection(EVENTS)
    .find({ userId, type: { $in: types } })
    .sort({ timestamp: 1 })
    .limit(2000)
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

/**
 * Walk the log once: what is currently saved, and what happened to each
 * item. Ascending order means the last save/unsave decides membership.
 */
async function replay(userId: string, kind: LibraryKind) {
  const names = EVENTS_FOR[kind];
  const events = await libraryEvents(userId, kind);

  const saved = new Map<string, { item: any; savedAt: string }>();
  const history = new Map<
    string,
    { attempts: number; wrong: number; lastGrade: CardGrade | null; lastCorrect: boolean | null }
  >();

  for (const event of events) {
    const payload = (event.payload ?? {}) as any;
    const id = String(payload.itemId || payload.cardId || payload.item?.id || "");
    if (!id) continue;

    if (event.type === names.saved) {
      const item = payload.item ?? payload.card;
      if (!item) continue;
      saved.set(id, { item: { ...item, id }, savedAt: iso(event.timestamp) });
    } else if (event.type === names.unsaved) {
      saved.delete(id);
    } else if (event.type === names.attempted) {
      const prior =
        history.get(id) ?? { attempts: 0, wrong: 0, lastGrade: null, lastCorrect: null };
      const grade = asGrade(payload.grade);
      const correct =
        typeof payload.correct === "boolean" ? payload.correct : grade === "known";
      history.set(id, {
        attempts: prior.attempts + 1,
        wrong: prior.wrong + (correct ? 0 : 1),
        lastGrade: grade ?? prior.lastGrade,
        lastCorrect: typeof payload.correct === "boolean" ? payload.correct : prior.lastCorrect,
      });
    }
  }

  return { saved, history };
}

export async function listSavedCards(userId: string): Promise<SavedFlashcard[]> {
  const { saved, history } = await replay(userId, "card");
  return Array.from(saved.entries())
    .map(([id, entry]) => {
      const h = history.get(id);
      return {
        ...(entry.item as Flashcard),
        savedAt: entry.savedAt,
        reviews: h?.attempts ?? 0,
        missed: h?.wrong ?? 0,
        lastGrade: h?.lastGrade ?? null,
      };
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function listSavedQuestions(
  userId: string
): Promise<SavedQuizQuestion[]> {
  const { saved, history } = await replay(userId, "question");
  return Array.from(saved.entries())
    .map(([id, entry]) => {
      const h = history.get(id);
      return {
        ...(entry.item as QuizQuestion),
        savedAt: entry.savedAt,
        attempts: h?.attempts ?? 0,
        wrong: h?.wrong ?? 0,
        lastCorrect: h?.lastCorrect ?? null,
      };
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * Prior difficulty per item id, for ordering a freshly generated set so the
 * items already known to be hard come first. Cheap: one query, and a set is
 * only ever a handful of items.
 */
export async function priorDifficulty(
  userId: string,
  kind: LibraryKind
): Promise<Record<string, { wrong: number; attempts: number }>> {
  const { history } = await replay(userId, kind);
  const out: Record<string, { wrong: number; attempts: number }> = {};
  for (const [id, h] of history) {
    out[id] = { wrong: h.wrong, attempts: h.attempts };
  }
  return out;
}

export { EVENTS_FOR };
