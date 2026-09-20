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
  searchElasticDocuments,
} from "./elastic";
import { eventsToTranscript, recentEvents } from "./events";
import { sessionScopedFilter } from "./groups";
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

Choosing "nextAction" and "intervention":
- POINT: draw attention, say nothing about why.
- ASK: a question they can answer from what is in front of them.
- NUDGE: one conceptual sentence that reframes, still without the answer.
- EXPERIMENT: the smallest change that would test their belief ("change only X, then look again").
- UNDERSTANDING_CHECK: after a step succeeded, check they know WHY before moving on.
- NEXT_STEP: the current step is genuinely resolved.

"intervention" is the literal sentence LENS says to the student. It must never contain the answer, the correct value, or the fix stated as an instruction to copy. "Reverse only the LED, then look again" is allowed — it is a test, not an explanation. "The LED is backwards because the cathode must go to ground" is not.

When nextAction is UNDERSTANDING_CHECK, fill "understandingCheck" with a question, 2-4 options, the correct index, and a one-sentence rationale. Otherwise set it to null.

"citations" classifies the numbered excerpts from the student's own material, if any were given. For each excerpt that bears on what the student did or believes, return {"n": <excerpt number>, "relation": "supports" | "contradicts", "quote": "<exact words copied from that excerpt>"}. Use "contradicts" only when the excerpt directly conflicts with what the log shows the student did or believes. Copy the quote character for character; never paraphrase. Omit excerpts that are unrelated. Return [] when none apply.`;

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
};

export type Passage = { sourceId: string; title: string; text: string };

/** Same filter GET /api/sources uses: in this session's scope, and active. */
async function activeSessionSourceIds(userId: string, sessionId: string) {
  const scoped = await sessionScopedFilter(userId, sessionId);
  if (!scoped) return [];
  const db = await getDb();
  const rows = await db
    .collection("sources")
    .find({ ...scoped, active: true }, { projection: { _id: 1 } })
    .toArray();
  return rows.map((r) => String(r._id));
}

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
  k = 4
): Promise<Passage[]> {
  const allowed = await activeSessionSourceIds(userId, sessionId);
  if (!allowed.length) return [];
  const q = query.slice(0, 500);
  const hits: any[] = elasticEnabled()
    ? await hybridSearchElastic({ userId, query: q, k, sourceIds: allowed })
    : await vectorSearchSources({ userId, query: q, k: k * 3 });
  const ok = new Set(allowed);
  return hits
    .map((h) => ({
      sourceId: String(h.sourceId ?? h._id),
      title: String(h.title || "Untitled"),
      // Elastic hits carry the passage as `text`; Mongo hits as `extractedText`.
      text: String(h.text ?? h.extractedText ?? "").trim(),
    }))
    .filter((p) => p.text && ok.has(p.sourceId))
    .slice(0, k);
}

/**
 * Citations are built from the retrieved passages, not from model prose.
 * The model only picks which excerpt and (optionally) which span; a span
 * that is not literally in the passage is discarded for the passage's
 * opening words. Excerpts the model calls unrelated are dropped.
 */
function buildCitations(raw: ModelOutput["citations"], passages: Passage[]): Citation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of raw) {
    const p = passages[Number(c?.n) - 1];
    if (!p || (c.relation !== "supports" && c.relation !== "contradicts")) continue;
    const text = squash(p.text);
    const span = squash(String(c.quote ?? ""));
    const quote = span && text.includes(span) ? span.slice(0, 400) : text.slice(0, 300);
    const key = `${p.sourceId}|${quote}`;
    if (!quote || seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: p.title,
      quote,
      sourceId: p.sourceId,
      contradicts: c.relation === "contradicts",
    });
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
): Promise<ReasoningState> {
  const events = await recentEvents(input.sessionId, 40);

  // Rule 1 — refuse to infer from nothing.
  if (events.length < 2) {
    return persistState({
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
    });
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
  if (input.useSources !== false && evidenceQuery) {
    try {
      passages = await retrievePassages(input.userId, input.sessionId, evidenceQuery, 4);
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

  const ladderCap = nextAllowedLevel(events);

  const user = `== SESSION EVENT LOG (oldest first, these are real recorded actions) ==
${transcript}
${input.latestObservation ? `\n== FRESHEST CAMERA OBSERVATION ==\n${input.latestObservation}` : ""}
${sourceContext}

== OBJECTIVE ==
${input.objective || "(not stated — infer it from the log)"}

== ESCALATION CAP ==
You may escalate no further than: ${ladderCap}. ${
    ladderCap === "EXPLAIN"
      ? "The student has attempted every earlier rung; a real explanation is now warranted."
      : "Do not skip ahead of this rung, however tempting."
  }

Respond with a JSON object with exactly these keys: objective, probableBelief, misconception, confidence, evidence, nextAction, intervention, understandingCheck, citations.`;

  const out = await llmJson<ModelOutput>(SYSTEM, user, {
    temperature: 0.3,
    maxTokens: 1200,
    thinking: "high",
  });

  return persistState({
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
  });
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

export async function latestReasoningState(
  sessionId: string
): Promise<ReasoningState | null> {
  if (!ObjectId.isValid(sessionId)) return null;
  if (elasticPrimary()) {
    try {
      const rows = await searchElasticDocuments<any>("reasoning", sessionId, 1, false);
      if (rows?.[0]) return serializeState(rows[0]);
    } catch (error) {
      console.warn("[reasoning] Elastic read failed, falling back to Mongo:", (error as Error).message);
    }
  }
  const db = await getDb();
  const row = await db
    .collection(REASONING_STATES)
    .findOne(
      { sessionId: new ObjectId(sessionId) },
      { sort: { createdAt: -1 } }
    );
  return row ? serializeState(row) : null;
}

/** Full history — this is what the reasoning graph renders. */
export async function reasoningTimeline(
  sessionId: string,
  limit = 25
): Promise<ReasoningState[]> {
  if (!ObjectId.isValid(sessionId)) return [];
  if (elasticPrimary()) {
    try {
      const rows = await searchElasticDocuments<any>("reasoning", sessionId, limit, true);
      if (rows) return rows.map(serializeState);
    } catch (error) {
      console.warn("[reasoning] Elastic timeline failed, falling back to Mongo:", (error as Error).message);
    }
  }
  const db = await getDb();
  const rows = await db
    .collection(REASONING_STATES)
    .find({ sessionId: new ObjectId(sessionId) })
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
