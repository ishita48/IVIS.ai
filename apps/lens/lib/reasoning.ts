/**
 * LENS Reasoning Engine — reconstructs where reasoning diverged.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 2 (Vision & Reasoning).
 *
 * Input:  the session's REAL event log + the top-k retrieved chunks of the
 *         student's own material (Atlas Vector Search, already built).
 * Output: one `reasoning_states` document — a probable belief, the specific
 *         misconception, the evidence it rests on, and the single smallest
 *         next intervention.
 *
 * Two rules this module enforces in code rather than in the prompt, because
 * a prompt is a request and code is a guarantee:
 *
 *   1. Under 2 real events, it returns `insufficientEvidence: true` and the
 *      UI renders "not enough evidence yet". It does not guess a
 *      misconception from a single frame — that is how you end up with a
 *      confident, wrong tutor.
 *   2. The intervention is capped at the next rung of the hint ladder. The
 *      model cannot jump to EXPLAIN because it is impatient; escalation is
 *      computed from how many hints have already been issued.
 */

import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import { llmJson } from "./llm";
import { vectorSearchSources } from "./embeddings";
import { elasticEnabled, hybridSearchElastic } from "./elastic";
import {
  elasticPrimary,
  indexElasticDocument,
  listElasticSources,
  searchElasticDocuments,
} from "./elastic";
import { eventsToTranscript, recentEvents } from "./events";
import { sessionScopedFilter } from "./groups";
import { mistakesToContext, recallMistakes, recordMistake } from "./mistakes";
import { curatedLadderFor, rungAction, rungLevel, unlockedRung } from "./objectives";
import { recordSkip } from "./token-ledger";
import {
  HINT_LADDER,
  type Citation,
  type HintLevel,
  type LensEvent,
  type ReasoningState,
} from "./lens/contracts";

export const REASONING_STATES = "reasoning_states";

const SYSTEM = `You are the reasoning core of LENS, a tutor that never gives the answer.

You are given a real log of what a student just did — camera observations of their physical workspace, the predictions they made, the checks they answered — plus excerpts from their own course material.

Your job is NOT to solve their problem. It is to reconstruct, from evidence, the specific point where their reasoning diverged from the material, and choose the SMALLEST next intervention.

How to think:
- "probableBelief" is what the student currently seems to think is true. Phrase it in their voice, e.g. "the longer leg is just for grip".
- "misconception" is the one specific idea that is wrong. Not a topic ("circuits"), a belief ("LED polarity does not affect current flow").
- "evidence" must reference the numbered events you were given (e.g. "#3: predicted 'shorter leg'"). Never cite an event that is not in the log.
- If the log does not support a conclusion, say so honestly with low confidence rather than inventing one.
- A student merely asking a question ("what's a predicate?") is not evidence of a misconception. Infer a belief only from something the student stated, predicted, or did. If all you have is a question, set "probableBelief" and "misconception" to null and choose ASK or NUDGE.

Choosing "nextAction" and "intervention":
- POINT: draw attention, say nothing about why.
- ASK: a question they can answer from what is in front of them.
- NUDGE: one conceptual sentence that reframes, still without the answer.
- EXPERIMENT: the smallest change that would test their belief ("change only X, then look again").
- UNDERSTANDING_CHECK: after a step succeeded, check they know WHY before moving on.
- NEXT_STEP: the current step is genuinely resolved.

"intervention" is the literal sentence LENS says to the student. It must never contain the answer, the correct value, or the fix stated as an instruction to copy. "Reverse only the LED, then look again" is allowed — it is a test, not an explanation. "The LED is backwards because the cathode must go to ground" is not.

When nextAction is UNDERSTANDING_CHECK, fill "understandingCheck" with a question, 2-4 options, the correct index, and a one-sentence rationale. Otherwise set it to null.

"citations" classifies the numbered excerpts from the student's own material, if any were given. For each excerpt that bears on what the student did or believes, return {"n": <excerpt number>, "relation": "supports" | "contradicts", "quote": "<exact words copied from that excerpt>"}. Use "contradicts" only when the excerpt directly conflicts with what the log shows the student did or believes. Cite an excerpt only if it directly bears on the belief you state; zero citations is fine, and you must never pad. "quote" is required and must be copied character for character from that excerpt; never paraphrase. An entry without a valid quote is discarded. Return at most 2. Omit excerpts that are unrelated. Return [] when none apply.

"relatedToNotes": when excerpts from the student's material are given, set it to true only if what the student said or did concerns something those excerpts actually cover. If it does not, set it to false and set probableBelief, misconception, intervention and understandingCheck to null. When no excerpts are given, set it to true.`;

type ModelOutput = {
  objective: string;
  probableBelief: string | null;
  misconception: string | null;
  confidence: number;
  evidence: string[];
  nextAction: ReasoningState["nextAction"];
  intervention: string | null;
  understandingCheck: ReasoningState["understandingCheck"];
  citations?: { n: number; relation: string; quote?: string }[];
  relatedToNotes?: boolean;
};

export type AnalyzeResult =
  | { skipped: "not_in_notes" }
  | {
      state: ReasoningState;
      outcome: "created" | "updated" | "unchanged" | "insufficient";
    };

/**
 * Vector similarity (0–1) a passage must reach to count as "in the notes".
 * Chosen from measured scores on Lecture1 — relevant queries topped out at
 * 0.70–0.80, irrelevant ones at 0.55–0.64. Rank-fusion and BM25 scores were
 * useless for this: they scored "fair game" the same as "quantifiers".
 */
export const MIN_VECTOR_SCORE = 0.67;

export type Passage = { sourceId: string; title: string; text: string; score?: number };

/**
 * Same lookup GET /api/sources uses: Elastic first (this is how sources for
 * an Elastic-native, UUID session are actually found - the Mongo `sources`
 * collection was never guaranteed to have a matching row for one), Mongo as
 * the fallback for sessions that predate the Elastic source index.
 *
 * Elastic's source index has no mute flag - a source is written once at
 * upload and never updated when muted. "active" has only ever been tracked
 * in Mongo, so an Elastic hit is excluded only when a Mongo `sources` doc
 * under the same id exists AND says `active: false`; a hit with no Mongo
 * counterpart (Elastic-only, e.g. Mongo was unavailable at upload) is kept.
 */
export async function activeSessionSourceIds(userId: string, sessionId: string) {
  const scoped = await sessionScopedFilter(userId, sessionId);
  if (!scoped) return [];

  if (elasticPrimary()) {
    try {
      const elasticSources = await listElasticSources({ userId, sessionId });
      if (elasticSources) {
        const ids = elasticSources.map((s) => String(s._id));
        const mongoIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
        const db = await getDb();
        const muted = mongoIds.length
          ? await db
              .collection("sources")
              .find({ _id: { $in: mongoIds }, active: false }, { projection: { _id: 1 } })
              .toArray()
          : [];
        const mutedIds = new Set(muted.map((m) => String(m._id)));
        return ids.filter((id) => !mutedIds.has(id));
      }
    } catch (error) {
      console.warn("[reasoning] Elastic source lookup failed, trying Mongo:", (error as Error).message);
    }
  }

  const db = await getDb();
  const rows = await db
    .collection("sources")
    .find({ ...scoped, active: true }, { projection: { _id: 1 } })
    .toArray();
  return rows.map((r) => String(r._id));
}

const MAX_CITATIONS = 2;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Top passages from the student's ACTIVE sources in THIS session — muted or
 * other-session material never comes back. Shared by the reasoning engine
 * and the live agent's search_notes tool. Throws on retrieval failure.
 */
export async function retrievePassages(
  userId: string,
  sessionId: string,
  query: string,
  k = 4,
  opts: { allowed?: string[]; minScore?: number } = {}
): Promise<Passage[]> {
  const allowed = opts.allowed ?? (await activeSessionSourceIds(userId, sessionId));
  if (!allowed.length) return [];
  const q = query.slice(0, 500);
  const elastic = elasticEnabled();
  const hits: any[] = elastic
    ? await hybridSearchElastic({ userId, query: q, k, sourceIds: allowed })
    : await vectorSearchSources({ userId, query: q, k: k * 3 });
  const ok = new Set(allowed);
  const found = hits
    .map((h) => ({
      sourceId: String(h.sourceId ?? h._id),
      title: String(h.title || "Untitled"),
      // Elastic hits carry the passage as `text`; Mongo hits as `extractedText`.
      text: String(h.text ?? h.extractedText ?? "").trim(),
      // Similarity, not the rank-fusion `score` Elastic returns.
      score: (elastic ? h.vectorScore : h.score) as number | undefined,
    }))
    .filter((p) => p.text && ok.has(p.sourceId));
  if (opts.minScore !== undefined) {
    const kept = found.filter((p) => (p.score ?? 0) >= opts.minScore!);
    // Logged so the cutoff can be re-checked against real usage.
    console.info(
      `[retrieve] top vectorScore=${Math.max(0, ...found.map((p) => p.score ?? 0)).toFixed(3)} kept=${kept.length}/${found.length}`
    );
    return kept.slice(0, k);
  }
  return found.slice(0, k);
}

/**
 * Citations are built from the retrieved passages, not from model prose.
 * The model picks which excerpt and which span; a span that is not
 * literally in the passage drops the citation. Excerpts the model calls
 * unrelated are dropped too, and a card carries at most MAX_CITATIONS.
 */
function buildCitations(raw: ModelOutput["citations"], passages: Passage[]): Citation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of raw) {
    const p = passages[Number(c?.n) - 1];
    if (!p || (c.relation !== "supports" && c.relation !== "contradicts")) continue;
    // Only a span the model returned that is literally in the passage counts.
    const quote = squash(String(c.quote ?? ""));
    if (!quote || !squash(p.text).includes(quote)) continue;
    const key = `${p.sourceId}|${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: p.title,
      quote,
      sourceId: p.sourceId,
      contradicts: c.relation === "contradicts",
    });
    if (out.length === MAX_CITATIONS) break;
  }
  return out;
}

export type AnalyzeReasoningInput = {
  sessionId: string;
  userId: string;
  /** What the student said they are doing. Falls back to inference. */
  objective?: string;
  /** Freshest vision observation, when this is called right after a frame. */
  latestObservation?: string | null;
  /** What the student just said aloud (live screen). Falls back to the last voice_turn. */
  spokenText?: string | null;
  /** Skip retrieval when the session has no uploaded material yet. */
  useSources?: boolean;
};

export async function analyzeReasoning(
  input: AnalyzeReasoningInput
): Promise<AnalyzeResult> {
  const events = await recentEvents(input.sessionId, input.userId, 40);

  // Rule 1 — refuse to infer from nothing.
  if (events.length < 2) {
    return {
      outcome: "insufficient",
      state: await persistState({
        sessionId: input.sessionId,
        objective: input.objective || "Not enough evidence yet",
        probableBelief: null,
        misconception: null,
        confidence: 0,
        evidence: events.map((e) => `${e.type} recorded`),
        nextAction: "POINT",
        intervention: null,
        hintLevel: "OBSERVE",
        understandingCheck: null,
        insufficientEvidence: true,
      }),
    };
  }

  // Demo objects — the misconception is known in advance, so the ladder is
  // authored, not improvised, and the model is not woken. The cap still
  // decides which rung ships; the rest stay on the server.
  const curated = curatedLadderFor(input.objective, events);
  if (curated) {
    const cap = nextAllowedLevel(events);
    const rung = unlockedRung(curated.misconception, cap);
    if (rung) {
      void recordSkip({
        scope: { sessionId: input.sessionId, userId: input.userId },
        purpose: "reasoning.analyze",
        reason: `curated ladder: ${curated.objective.id}/${curated.misconception.id}`,
        concept: curated.misconception.id,
      });
      void recordMistake({
        userId: input.userId,
        sessionId: input.sessionId,
        surface: "reasoning",
        concept: curated.misconception.id,
        belief: curated.misconception.belief,
        rootCause: curated.misconception.misconception,
        evidence: `#${curated.eventIndex}: predicted '${curated.prediction}'`,
      }).catch(() => undefined);
      const state = await persistState({
        sessionId: input.sessionId,
        objective: input.objective || curated.objective.objective,
        probableBelief: curated.misconception.belief,
        misconception: curated.misconception.misconception,
        confidence: 0.9,
        evidence: [`#${curated.eventIndex}: predicted '${curated.prediction}'`],
        nextAction: rungAction(rung.rung),
        intervention: rung.text,
        hintLevel: rungLevel(rung.rung),
        understandingCheck: null,
        insufficientEvidence: false,
      });
      return { state, outcome: "created" };
    }
  }

  const transcript = eventsToTranscript(events);
  // Search what the student actually said, then what they are doing.
  const lastSpoken =
    input.spokenText?.trim() ||
    [...events]
      .reverse()
      .find((e) => e.type === "voice_turn" && (e.payload as any)?.role === "user")
      ?.payload?.text;
  const evidenceQuery = [
    typeof lastSpoken === "string" ? lastSpoken : "",
    input.latestObservation ||
      input.objective ||
      events
        .slice(-3)
        .map((e) => (e.payload as any)?.observation || e.concept || e.type)
        .join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  // Ground in the student's OWN material where we have it. Retrieval
  // failures are non-fatal: the reasoning is about their actions first.
  let sourceContext = "";
  let passages: Passage[] = [];
  // True only when the student has active notes AND retrieval actually ran —
  // an outage must not read as "your notes don't cover this".
  let searchedNotes = false;
  if (input.useSources !== false && evidenceQuery) {
    try {
      const allowed = await activeSessionSourceIds(input.userId, input.sessionId);
      if (allowed.length) {
        passages = await retrievePassages(input.userId, input.sessionId, evidenceQuery, 4, {
          allowed,
          minScore: MIN_VECTOR_SCORE,
        });
        searchedNotes = true;
      }
      if (passages.length) {
        sourceContext =
          "\n\n== EXCERPTS FROM THE STUDENT'S OWN MATERIAL (numbered) ==\n" +
          passages
            .map((p, i) => `[${i + 1}] "${p.title}": ${p.text.slice(0, 600)}`)
            .join("\n");
      }
    } catch {
      /* retrieval is best-effort evidence, never a hard dependency */
    }
  }

  // Notes exist but nothing in them is close to what the student said or did.
  if (searchedNotes && !passages.length) return { skipped: "not_in_notes" };

  // Mistake memory as evidence. This is the difference between a tutor
  // that sees one session and one that sees a student: the same belief,
  // recognised across a circuit, a quiz and a flashcard, weeks apart.
  let memoryContext = "";
  try {
    const recalled = await recallMistakes({
      userId: input.userId,
      query: String(evidenceQuery).slice(0, 500),
      k: 3,
      excludeSessionId: input.sessionId,
    });
    if (recalled.length) {
      memoryContext = [
        "",
        "== BELIEFS THIS STUDENT HAS SHOWN BEFORE (other sessions) ==",
        mistakesToContext(recalled),
        "If the current evidence matches one of these, say so in probableBelief and raise confidence. A belief that keeps coming back is the one worth addressing.",
      ].join("\n");
    }
  } catch {
    /* memory is additive evidence, never a hard dependency */
  }

  const ladderCap = nextAllowedLevel(events);

  const user = `== SESSION EVENT LOG (oldest first, these are real recorded actions) ==
${transcript}
${input.latestObservation ? `\n== FRESHEST CAMERA OBSERVATION ==\n${input.latestObservation}` : ""}
${sourceContext}${memoryContext}

== OBJECTIVE ==
${input.objective || "(not stated — infer it from the log)"}

== ESCALATION CAP ==
You may escalate no further than: ${ladderCap}. ${
    ladderCap === "EXPLAIN"
      ? "The student has attempted every earlier rung; a real explanation is now warranted."
      : "Do not skip ahead of this rung, however tempting."
  }

Respond with a JSON object with exactly these keys: objective, probableBelief, misconception, confidence, evidence, nextAction, intervention, understandingCheck, citations, relatedToNotes.`;

  const out = await llmJson<ModelOutput>(SYSTEM, user, {
    temperature: 0.3,
    maxTokens: 1200,
    thinking: "high",
    // Pinned to OpenAI. Measured on this account: Gemma returns this shape
    // in 23-27s, OpenAI in ~1s — and `thinking: "off"` does not help, so it
    // is the model, not the config. A 25-second pause is survivable in a
    // batch job and fatal on a surface a student is watching. Flip
    // LLM_PRIMARY if the cost trade ever changes.
    provider: "openai",
    ledger: { sessionId: input.sessionId, userId: input.userId },
    purpose: "reasoning.analyze",
  });

  // Second check: the model itself says the student is off the notes.
  if (searchedNotes && out.relatedToNotes === false) return { skipped: "not_in_notes" };

  // Feed the engine's own conclusion back into memory. Camera, quiz,
  // flashcards and the reasoning engine all write to the same index, which
  // is what makes recurrence detectable across surfaces at all.
  if (out.misconception && out.probableBelief) {
    void recordMistake({
      userId: input.userId,
      sessionId: input.sessionId,
      surface: "reasoning",
      concept: out.misconception,
      belief: out.probableBelief,
      rootCause: out.misconception,
      evidence: (Array.isArray(out.evidence) ? out.evidence[0] : "") || "",
    }).catch(() => undefined);
  }

  const next: ReasoningState = {
    sessionId: input.sessionId,
    objective: out.objective || input.objective || "Working through a problem",
    probableBelief: out.probableBelief ?? null,
    misconception: out.misconception ?? null,
    confidence: clamp01(out.confidence),
    evidence: Array.isArray(out.evidence) ? out.evidence.slice(0, 6) : [],
    nextAction: out.nextAction || "ASK",
    intervention: out.intervention ?? null,
    // Rule 2 — the ladder is enforced here, not trusted to the model.
    hintLevel: capLevel(actionToLevel(out.nextAction), ladderCap),
    understandingCheck:
      out.nextAction === "UNDERSTANDING_CHECK" ? out.understandingCheck ?? null : null,
    insufficientEvidence: false,
    citations: buildCitations(out.citations, passages),
  };

  // Same belief as the latest card → refresh that card, don't stack another.
  const latest = await latestReasoningState(input.sessionId, input.userId);
  if (latest && !latest.insufficientEvidence && sameBelief(latest, next)) {
    // Keep the card's question unless the ladder went up; a reworded question
    // at the same rung is noise, not progress.
    const escalated = HINT_LADDER.indexOf(next.hintLevel) > HINT_LADDER.indexOf(latest.hintLevel);
    const merged: ReasoningState = {
      ...latest,
      confidence: next.confidence,
      evidence: next.evidence,
      citations: next.citations,
      ...(escalated
        ? {
            nextAction: next.nextAction,
            hintLevel: next.hintLevel,
            intervention: next.intervention,
            understandingCheck: next.understandingCheck,
          }
        : {}),
    };
    if (!changed(latest, merged)) return { state: latest, outcome: "unchanged" };
    return { state: await updateState(merged), outcome: "updated" };
  }
  return { state: await persistState(next), outcome: "created" };
}

// ── Dedupe ────────────────────────────────────────────────────────────

const norm = (s: string) => squash(s).toLowerCase();

/** Exact match after normalising, or ≥80% token overlap. */
function similar(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / new Set([...ta, ...tb]).size >= 0.8;
}

/**
 * Same belief if EITHER the objective + misconception match, OR the
 * probableBelief matches. The model rewords the misconception on every run
 * while the belief stays put, so the belief is the steadier signal. Null
 * fields are never compared — two nulls are not a match.
 */
function sameBelief(a: ReasoningState, b: ReasoningState): boolean {
  if (a.misconception && b.misconception) {
    if (similar(norm(`${a.objective} ${a.misconception}`), norm(`${b.objective} ${b.misconception}`)))
      return true;
  }
  if (a.probableBelief && b.probableBelief) {
    if (similar(norm(a.probableBelief), norm(b.probableBelief))) return true;
  }
  return false;
}

function changed(a: ReasoningState, b: ReasoningState): boolean {
  const pick = (s: ReasoningState) =>
    JSON.stringify([
      s.probableBelief, s.confidence, s.evidence, s.citations ?? [], s.intervention,
      s.nextAction, s.hintLevel, s.understandingCheck,
    ]);
  return pick(a) !== pick(b);
}

// ── Hint ladder enforcement ───────────────────────────────────────────

function actionToLevel(action: ReasoningState["nextAction"]): HintLevel {
  switch (action) {
    case "POINT":
      return "POINT";
    case "ASK":
    case "UNDERSTANDING_CHECK":
      return "ASK";
    case "NUDGE":
      return "NUDGE";
    case "EXPERIMENT":
      return "EXPERIMENT";
    default:
      return "OBSERVE";
  }
}

function capLevel(level: HintLevel, cap: HintLevel): HintLevel {
  const i = HINT_LADDER.indexOf(level);
  const c = HINT_LADDER.indexOf(cap);
  return HINT_LADDER[Math.min(i, c)];
}

/**
 * The furthest rung LENS is allowed to reach right now. One rung per
 * genuine student attempt — a prediction, a retry, or an answered check.
 * This is why LENS visibly escalates during a demo instead of front-loading
 * an explanation on turn one.
 */
export function nextAllowedLevel(events: LensEvent[]): HintLevel {
  const attempts = events.filter(
    (e) =>
      e.type === "prediction" ||
      e.type === "retry" ||
      e.type === "understanding_check_answered" ||
      e.type === "experiment_completed"
  ).length;
  return HINT_LADDER[Math.min(attempts + 1, HINT_LADDER.length - 1)];
}

// ── Persistence ───────────────────────────────────────────────────────

async function persistState(state: ReasoningState): Promise<ReasoningState> {
  const doc = {
    ...state,
    sessionId: state.sessionId,
    createdAt: new Date().toISOString(),
  };
  if (elasticPrimary()) {
    try {
      const id = crypto.randomUUID();
      await indexElasticDocument("reasoning", id, doc);
      return { ...state, _id: id, createdAt: doc.createdAt };
    } catch (error) {
      console.warn("[reasoning] Elastic write failed, falling back to Mongo:", (error as Error).message);
    }
  }
  const db = await getDb();
  const res = await db.collection(REASONING_STATES).insertOne({
    ...doc,
    sessionId: new ObjectId(state.sessionId),
    createdAt: new Date(doc.createdAt),
  } as any);
  return {
    ...state,
    _id: res.insertedId.toString(),
    createdAt: new Date().toISOString(),
  };
}

/** Overwrite an existing state in place, in whichever store holds it. */
async function updateState(state: ReasoningState): Promise<ReasoningState> {
  const { _id, ...rest } = state;
  const id = String(_id);
  // Mongo ids are 24-char ObjectIds; Elastic states use UUIDs.
  if (id.length !== 24 || !ObjectId.isValid(id)) {
    await indexElasticDocument("reasoning", id, rest as Record<string, unknown>);
    return state;
  }
  const db = await getDb();
  const { createdAt: _c, sessionId: _s, ...fields } = rest;
  await db.collection(REASONING_STATES).updateOne({ _id: new ObjectId(id) }, { $set: fields });
  return state;
}

export async function latestReasoningState(
  sessionId: string,
  userId: string
): Promise<ReasoningState | null> {
  if (elasticPrimary()) {
    try {
      const rows = await searchElasticDocuments<any>("reasoning", sessionId, userId, 1, false);
      if (rows?.[0]) return serializeState(rows[0]);
    } catch (error) {
      console.warn("[reasoning] Elastic read failed, falling back to Mongo:", (error as Error).message);
    }
  }
  if (!ObjectId.isValid(sessionId)) return null;
  const db = await getDb();
  const row = await db
    .collection(REASONING_STATES)
    .findOne(
      { sessionId: new ObjectId(sessionId), userId },
      { sort: { createdAt: -1 } }
    );
  return row ? serializeState(row) : null;
}

/** Full history — this is what the reasoning graph renders. */
export async function reasoningTimeline(
  sessionId: string,
  userId: string,
  limit = 25
): Promise<ReasoningState[]> {
  if (elasticPrimary()) {
    try {
      const rows = await searchElasticDocuments<any>("reasoning", sessionId, userId, limit, true);
      if (rows) return rows.map(serializeState);
    } catch (error) {
      console.warn("[reasoning] Elastic timeline failed, falling back to Mongo:", (error as Error).message);
    }
  }
  if (!ObjectId.isValid(sessionId)) return [];
  const db = await getDb();
  const rows = await db
    .collection(REASONING_STATES)
    .find({ sessionId: new ObjectId(sessionId), userId })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
  return rows.map(serializeState);
}

function serializeState(r: any): ReasoningState {
  return {
    _id: r._id?.toString(),
    sessionId: r.sessionId?.toString(),
    objective: r.objective,
    probableBelief: r.probableBelief ?? null,
    misconception: r.misconception ?? null,
    confidence: r.confidence ?? 0,
    evidence: r.evidence ?? [],
    nextAction: r.nextAction ?? "POINT",
    intervention: r.intervention ?? null,
    hintLevel: r.hintLevel ?? "OBSERVE",
    understandingCheck: r.understandingCheck ?? null,
    insufficientEvidence: !!r.insufficientEvidence,
    citations: r.citations ?? [],
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : undefined,
  };
}

function clamp01(n: any): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
