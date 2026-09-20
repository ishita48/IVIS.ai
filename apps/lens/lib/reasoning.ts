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
import { mistakesToContext, recallMistakes, recordMistake } from "./mistakes";
import {
  HINT_LADDER,
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

When nextAction is UNDERSTANDING_CHECK, fill "understandingCheck" with a question, 2-4 options, the correct index, and a one-sentence rationale. Otherwise set it to null.`;

type ModelOutput = {
  objective: string;
  probableBelief: string | null;
  misconception: string | null;
  confidence: number;
  evidence: string[];
  nextAction: ReasoningState["nextAction"];
  intervention: string | null;
  understandingCheck: ReasoningState["understandingCheck"];
};

export type AnalyzeReasoningInput = {
  sessionId: string;
  userId: string;
  /** What the student said they are doing. Falls back to inference. */
  objective?: string;
  /** Freshest vision observation, when this is called right after a frame. */
  latestObservation?: string | null;
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
  const evidenceQuery =
    input.latestObservation ||
    input.objective ||
    events
      .slice(-3)
      .map((e) => (e.payload as any)?.observation || e.concept || e.type)
      .join(" ");

  // Ground in the student's OWN material where we have it. Retrieval
  // failures are non-fatal: the reasoning is about their actions first.
  let sourceContext = "";
  if (input.useSources !== false && evidenceQuery) {
    try {
      const hits = elasticEnabled()
        ? await hybridSearchElastic({
            userId: input.userId,
            query: String(evidenceQuery).slice(0, 500),
            k: 4,
          })
        : await vectorSearchSources({
            userId: input.userId,
            query: String(evidenceQuery).slice(0, 500),
            k: 4,
          });
      if (hits.length) {
        sourceContext =
          "\n\n== EXCERPTS FROM THE STUDENT'S OWN MATERIAL ==\n" +
          hits
            .map(
              (h: any) =>
                `- "${h.title}": ${String(h.extractedText || "").slice(0, 240)}`
            )
            .join("\n");
      }
    } catch {
      /* retrieval is best-effort evidence, never a hard dependency */
    }
  }

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

Respond with a JSON object with exactly these keys: objective, probableBelief, misconception, confidence, evidence, nextAction, intervention, understandingCheck.`;

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
  if (elasticPrimary()) {
    try {
      const rows = await searchElasticDocuments<any>("reasoning", sessionId, 1, false);
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
  if (elasticPrimary()) {
    try {
      const rows = await searchElasticDocuments<any>("reasoning", sessionId, limit, true);
      if (rows) return rows.map(serializeState);
    } catch (error) {
      console.warn("[reasoning] Elastic timeline failed, falling back to Mongo:", (error as Error).message);
    }
  }
  if (!ObjectId.isValid(sessionId)) return [];
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
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : undefined,
  };
}

function clamp01(n: any): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
