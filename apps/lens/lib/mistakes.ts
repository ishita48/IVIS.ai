/**
 * LENS Mistake Memory — the same misconception, recognised across surfaces.
 * ─────────────────────────────────────────────────────────────────────
 *
 * A student does not have "a circuits problem" and separately "a quiz
 * problem". They have one wrong belief that surfaces wherever it is
 * relevant. This module is what lets LENS notice that:
 *
 *   camera:     "they're working as though the longer leg is just for grip"
 *   quiz:       picked the distractor that assumes polarity doesn't matter
 *   flashcards: keeps failing the card about current direction
 *
 * Three events, one belief. The point is to say so out loud — "you reached
 * for this same idea on Tuesday, on a different problem" — because a
 * student who sees their mistake recur learns something a per-session
 * tutor can never tell them.
 *
 * WHY THE EMBEDDING IS OF THE BELIEF, NOT THE ARTIFACT
 * Embedding the circuit, the code, or the quiz text clusters by surface:
 * every circuit lands near every other circuit. Embedding the *claim* —
 * "current can flow either way through an LED" — clusters by idea, which
 * is the only axis along which recurrence means anything. This is the one
 * design decision in the file that actually matters.
 *
 * DEDUPE, NOT APPEND
 * A recurrence increments `occurrences` on the existing document rather
 * than writing a second one. Otherwise "you've made this mistake 3 times"
 * would be a count of rows, which is a count of how often the model
 * happened to phrase it similarly — not a count of the student's mistakes.
 */

import {
  elasticPrimary,
  indexElasticDocument,
  knnSearchDocs,
  queryElasticDocs,
  updateElasticDoc,
} from "./elastic";
import { embedText } from "./embeddings";

/** Where a mistake was observed. */
export type MistakeSurface =
  | "camera"
  | "quiz"
  | "flashcards"
  | "guide"
  | "reasoning";

export type Mistake = {
  _id?: string;
  userId: string;
  sessionId: string;
  surface: MistakeSurface;
  /** Short concept slug, e.g. "led_polarity". */
  concept: string;
  /** What the student appears to believe, in their voice. The embedded text. */
  belief: string;
  /** What is actually going on, at concept level. */
  rootCause: string;
  /** One line of real evidence — what they did that showed this. */
  evidence: string;
  /** The source that contradicts the belief, when there is one. */
  sourceTitle?: string | null;
  resolved: boolean;
  occurrences: number;
  firstSeenAt: string;
  createdAt: string;
};

export type RecalledMistake = Mistake & {
  _id: string;
  /** Cosine similarity, 0–1. */
  score: number;
};

/**
 * THRESHOLDS — measured, not guessed.
 *
 * Elastic returns cosine similarity rescaled to (1 + cos) / 2, so the whole
 * usable range is 0.5 (orthogonal) to 1.0 (identical), not 0 to 1. Picking
 * numbers that "look like" similarity scores puts both thresholds far too
 * high and the feature silently never fires.
 *
 * Measured on text-embedding-3-small over real beliefs:
 *
 *   near-identical wording ................... 0.98 – 1.00
 *   SAME belief, different words ............. 0.808
 *     ("longer leg is just for grip" vs
 *      "current flows both ways through an LED")
 *   same belief, plain paraphrase ............ 0.79 – 0.82
 *   the belief showing up in behaviour ....... 0.69 – 0.70
 *     ("put the diode in backwards again")
 *   DIFFERENT belief, same subject ........... 0.60 – 0.64
 *     (resistors-in-parallel vs LED polarity)
 *   unrelated subject entirely ............... 0.54 – 0.56
 *
 * The gap that matters is 0.69 (same belief, different behaviour) against
 * 0.64 (genuinely different belief). It is narrow, so these are set to
 * favour firing: a false positive means LENS mentions a related past
 * mistake, which is a bit off; a false negative means the feature looks
 * broken. Re-measure if the embedding model changes — these numbers do not
 * transfer between models.
 */
const SAME_BELIEF = 0.78;

/** Below this, a recalled mistake is not worth mentioning to the student. */
export const WORTH_MENTIONING = 0.68;

export function mistakesEnabled(): boolean {
  return elasticPrimary();
}

/**
 * Record a mistake, merging into an existing one when the belief matches.
 * Returns the stored mistake and whether this was a recurrence — which is
 * the bit the UI actually wants.
 */
export async function recordMistake(input: {
  userId: string;
  sessionId: string;
  surface: MistakeSurface;
  concept?: string | null;
  belief: string;
  rootCause?: string | null;
  evidence?: string | null;
  sourceTitle?: string | null;
}): Promise<{ mistake: Mistake & { _id: string }; recurrence: boolean } | null> {
  if (!mistakesEnabled()) return null;

  const belief = input.belief.trim();
  if (belief.length < 8) return null;

  const embedding = await embedText(belief);
  if (!embedding) return null;

  const now = new Date().toISOString();

  // Does this student already hold this belief?
  const near = await knnSearchDocs<Mistake>("mistakes", {
    embedding,
    k: 1,
    filter: [{ term: { userId: input.userId } }],
  }).catch(() => null);

  const match = near?.[0];
  if (match && match._score >= SAME_BELIEF && match._id) {
    const occurrences = (match.occurrences ?? 1) + 1;
    await updateElasticDoc("mistakes", match._id, {
      occurrences,
      resolved: false, // it came back, so it is not resolved
      surface: input.surface,
      sessionId: input.sessionId,
      evidence: input.evidence ?? match.evidence,
      createdAt: now,
    });
    return {
      mistake: { ...match, _id: match._id, occurrences, resolved: false, createdAt: now },
      recurrence: true,
    };
  }

  const id = crypto.randomUUID();
  const doc: Mistake & { embedding: number[] } = {
    userId: input.userId,
    sessionId: input.sessionId,
    surface: input.surface,
    concept: (input.concept || "").trim() || "general",
    belief,
    rootCause: (input.rootCause || "").trim(),
    evidence: (input.evidence || "").trim(),
    sourceTitle: input.sourceTitle ?? null,
    resolved: false,
    occurrences: 1,
    firstSeenAt: now,
    createdAt: now,
    embedding,
  };

  await indexElasticDocument("mistakes", id, doc);
  const { embedding: _drop, ...stored } = doc;
  return { mistake: { ...stored, _id: id }, recurrence: false };
}

/**
 * What has this student believed before that is close to what is happening
 * now? Used as evidence by the reasoning engine and spoken by the tutor.
 */
export async function recallMistakes(input: {
  userId: string;
  query: string;
  k?: number;
  /** Exclude the session in progress, so it recalls history not the present. */
  excludeSessionId?: string;
  minScore?: number;
}): Promise<RecalledMistake[]> {
  if (!mistakesEnabled() || !input.query.trim()) return [];

  const embedding = await embedText(input.query);
  if (!embedding) return [];

  const hits = await knnSearchDocs<Mistake>("mistakes", {
    embedding,
    k: input.k ?? 4,
    filter: [{ term: { userId: input.userId } }],
  }).catch(() => null);
  if (!hits) return [];

  const floor = input.minScore ?? WORTH_MENTIONING;

  return hits
    .filter((hit) => hit._score >= floor)
    .filter((hit) => !input.excludeSessionId || hit.sessionId !== input.excludeSessionId)
    .map((hit) => ({ ...hit, _id: hit._id!, score: hit._score }));
}

/** Everything this student has got wrong, most persistent first. */
export async function listMistakes(
  userId: string,
  limit = 50
): Promise<(Mistake & { _id: string })[]> {
  if (!mistakesEnabled()) return [];
  const rows = await queryElasticDocs<Mistake & { _id: string }>("mistakes", {
    filter: [{ term: { userId } }],
    size: limit,
    sort: [{ occurrences: "desc" }, { createdAt: "desc" }],
  }).catch(() => null);
  return rows ?? [];
}

/**
 * Mark a belief as resolved. Called when the student demonstrates the
 * correct reasoning — which is what makes "misconceptions resolved" on the
 * metrics strip a falsifiable claim rather than a hopeful one.
 */
export async function resolveMistake(id: string): Promise<boolean> {
  if (!mistakesEnabled()) return false;
  await updateElasticDoc("mistakes", id, {
    resolved: true,
    resolvedAt: new Date().toISOString(),
  });
  return true;
}

/** One line per recalled mistake, for a prompt or a transcript. */
export function mistakesToContext(mistakes: RecalledMistake[]): string {
  if (!mistakes.length) return "";
  return mistakes
    .map((m) => {
      const when = new Date(m.firstSeenAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const times =
        m.occurrences > 1 ? `, seen ${m.occurrences} times` : "";
      return `- "${m.belief}" (first seen ${when} in ${m.surface}${times}; similarity ${m.score.toFixed(2)})`;
    })
    .join("\n");
}
