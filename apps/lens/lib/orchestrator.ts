/**
 * LENS Orchestrator — four passes, and the cheap one decides.
 * ─────────────────────────────────────────────────────────────────────
 *
 * This is NOT a second agent. The ElevenLabs agent owns the conversation
 * and always will; adding a rival orchestrator next to it is exactly what
 * ENGINEERING.md rule 7 warns against. This is a pipeline the reasoning
 * engine runs *inside*, and the agent reaches it through one tool call.
 *
 * The four passes, in the order they run:
 *
 *   1. RECALL      deterministic. Mistake memory (kNN) + the student's own
 *                  sources (hybrid) + the recent event log. Zero model
 *                  calls, ~200ms.
 *   2. GATE        deterministic. Decides whether the model needs to run
 *                  at all.
 *   3. DIAGNOSE    model. Names the belief and the misconception.
 *   4. VERIFY      model, adversarial. Asks whether the diagnosis is
 *                  actually supported by the evidence it was given.
 *
 * WHY THE ORDER MATTERS, AND WHY THE GATE IS THE POINT
 * Verifying every inference with a second model call is the reason nobody
 * ships a self-checking tutor: it doubles the cost of being right. Putting
 * a free pass first makes the expensive one affordable — when RECALL finds
 * a belief this student has already demonstrated, at high similarity, with
 * fresh evidence, there is nothing to diagnose. LENS already knows. The
 * gate returns the remembered belief and the model never wakes up.
 *
 * That is the same shape as useStallWatch (a free silence signal gating one
 * vision call) and it is the honest version of a "cost optimisation":
 * `callsAvoided` counts calls that genuinely did not happen.
 *
 * WHY VERIFY EXISTS
 * "What if your tutor is confidently wrong about what I believe?" is the
 * question this product has to answer, and a paragraph in a prompt is not
 * an answer. VERIFY is a separate call that only sees the evidence and the
 * conclusion, and can reject it. A rejected diagnosis is downgraded to
 * "not enough evidence yet" rather than spoken — which is the behaviour
 * ENGINEERING.md rule 6 already asks for, now enforced by a second opinion
 * instead of a row count.
 */

import { llmJson } from "./llm";
import { recentEvents, eventsToTranscript, recordEvent } from "./events";
import { analyzeReasoning } from "./reasoning";
import { recallMistakes, mistakesToContext, type RecalledMistake } from "./mistakes";
import { elasticEnabled, hybridSearchElastic } from "./elastic";
import { recordSkip } from "./token-ledger";
import type {
  OrchestratorTrace,
  ReasoningState,
  TraceStep,
} from "./lens/contracts";

/**
 * How similar a remembered belief must be to the current evidence before
 * the gate will skip the diagnosis. Well above WORTH_MENTIONING (0.68):
 * mentioning a related past mistake is cheap and forgiving, whereas
 * *substituting* it for a fresh diagnosis has to be nearly certain or LENS
 * starts insisting the student believes something they have moved past.
 */
export const GATE_CONFIDENCE = 0.88;

/** Under this many events there is nothing to reason about at all. */
const MIN_EVENTS = 2;

type Timed<T> = { value: T; ms: number };

async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

export type CouncilInput = {
  sessionId: string;
  userId: string;
  objective?: string;
  latestObservation?: string | null;
};

export type CouncilResult = {
  state: ReasoningState;
  trace: OrchestratorTrace;
  recalled: RecalledMistake[];
};

export async function runCouncil(input: CouncilInput): Promise<CouncilResult> {
  const startedAt = Date.now();
  const steps: TraceStep[] = [];
  let modelCalls = 0;
  let callsAvoided = 0;

  // ── 1. RECALL — free ────────────────────────────────────────────────
  const events = await recentEvents(input.sessionId, input.userId, 40);
  const evidenceQuery =
    input.latestObservation ||
    input.objective ||
    events
      .slice(-3)
      .map((e) => (e.payload as any)?.observation || e.concept || e.type)
      .join(" ");

  const recall = await timed(async () => {
    const [mistakes, sources] = await Promise.all([
      recallMistakes({
        userId: input.userId,
        query: String(evidenceQuery).slice(0, 500),
        k: 3,
      }).catch(() => [] as RecalledMistake[]),
      elasticEnabled()
        ? hybridSearchElastic({
            userId: input.userId,
            query: String(evidenceQuery).slice(0, 500),
            k: 3,
          }).catch(() => [])
        : Promise.resolve([]),
    ]);
    return { mistakes, sources };
  });

  steps.push({
    step: "RECALL",
    kind: "deterministic",
    ms: recall.ms,
    modelCalls: 0,
    summary: `${events.length} events · ${recall.value.mistakes.length} prior belief(s) · ${recall.value.sources.length} source passage(s)`,
  });

  // ── 2. GATE — free, and decides whether anything else runs ──────────
  const strongest = recall.value.mistakes[0];
  const hasFreshEvidence = events.length >= MIN_EVENTS;
  const gateFires =
    !!strongest && strongest.score >= GATE_CONFIDENCE && hasFreshEvidence;

  if (gateFires) {
    // Two calls that would have happened: DIAGNOSE and VERIFY.
    callsAvoided += 2;

    // Also write them to the token ledger. The ledger's `modelCallsSkipped`
    // was structurally zero because nothing had a real skip path yet — this
    // is that path, so the two counters are one feature seen from two
    // angles rather than two rival numbers on the same strip.
    for (const purpose of ["reasoning.diagnose", "reasoning.verify"]) {
      void recordSkip({
        scope: { sessionId: input.sessionId, userId: input.userId },
        purpose,
        reason: `RECALL matched a known belief at ${strongest!.score.toFixed(2)}`,
        provider: "openai",
      });
    }
    steps.push({
      step: "GATE",
      kind: "deterministic",
      ms: 0,
      modelCalls: 0,
      summary: `Known belief at ${strongest!.score.toFixed(2)} — reusing it, no model call needed`,
    });
    steps.push({
      step: "DIAGNOSE",
      kind: "model",
      ms: 0,
      modelCalls: 0,
      summary: "Skipped",
      skipped: "RECALL already had this belief above the gate threshold",
    });
    steps.push({
      step: "VERIFY",
      kind: "model",
      ms: 0,
      modelCalls: 0,
      summary: "Skipped",
      skipped: "Nothing new to verify — the belief is one LENS has already seen",
    });

    const state: ReasoningState = {
      sessionId: input.sessionId,
      objective: input.objective || "Continuing from a known belief",
      probableBelief: strongest!.belief,
      misconception: strongest!.rootCause || strongest!.belief,
      confidence: Math.min(0.9, strongest!.score),
      evidence: [
        `Recalled from ${strongest!.surface}, seen ${strongest!.occurrences}×, similarity ${strongest!.score.toFixed(2)}`,
        ...(strongest!.evidence ? [strongest!.evidence] : []),
      ],
      nextAction: "ASK",
      intervention: null,
      hintLevel: "ASK",
      understandingCheck: null,
      insufficientEvidence: false,
    };

    const trace = finish(input, steps, startedAt, modelCalls, callsAvoided, null, null);
    void persist(input, trace);
    return { state, trace, recalled: recall.value.mistakes };
  }

  steps.push({
    step: "GATE",
    kind: "deterministic",
    ms: 0,
    modelCalls: 0,
    summary: strongest
      ? `Closest prior belief only ${strongest.score.toFixed(2)} — below the gate, running the model`
      : "No prior belief close enough — running the model",
  });

  // ── 3. DIAGNOSE — the existing engine, unchanged ────────────────────
  const diagnosis = await timed(() =>
    analyzeReasoning({
      sessionId: input.sessionId,
      userId: input.userId,
      objective: input.objective,
      latestObservation: input.latestObservation,
    })
  );
  modelCalls += 1;

  // main's engine can decline before it reasons: when the question is not
  // covered by the student's own notes it returns { skipped: "not_in_notes" }
  // rather than a state. That is a THIRD cheap gate, and the trace should
  // say so rather than reporting a diagnosis that never happened.
  if ("skipped" in diagnosis.value) {
    steps.push({
      step: "DIAGNOSE",
      kind: "model",
      ms: diagnosis.ms,
      modelCalls: 1,
      summary: "Declined — the question is not covered by the student's notes",
      skipped: diagnosis.value.skipped,
    });
    steps.push({
      step: "VERIFY",
      kind: "model",
      ms: 0,
      modelCalls: 0,
      summary: "Skipped",
      skipped: "Nothing was diagnosed, so there is nothing to verify",
    });
    callsAvoided += 1;

    const state: ReasoningState = {
      sessionId: input.sessionId,
      objective: input.objective || "Outside the uploaded material",
      probableBelief: null,
      misconception: null,
      confidence: 0,
      evidence: ["The student's own sources do not cover this question."],
      nextAction: "POINT",
      intervention: null,
      hintLevel: "OBSERVE",
      understandingCheck: null,
      insufficientEvidence: true,
    };
    const trace = finish(input, steps, startedAt, modelCalls, callsAvoided, null, null);
    void persist(input, trace);
    return { state, trace, recalled: recall.value.mistakes };
  }

  let state = diagnosis.value.state;

  steps.push({
    step: "DIAGNOSE",
    kind: "model",
    ms: diagnosis.ms,
    modelCalls: 1,
    summary: state.insufficientEvidence
      ? "Not enough evidence yet — declined to guess"
      : `Belief: ${String(state.probableBelief || "—").slice(0, 70)}`,
  });

  // ── 4. VERIFY — adversarial second opinion ──────────────────────────
  let verified: boolean | null = null;
  let verifyNote: string | null = null;

  if (!state.insufficientEvidence && state.probableBelief) {
    const verify = await timed(() => verifyDiagnosis(events, state, recall.value.mistakes));
    modelCalls += 1;
    verified = verify.value.checked ? verify.value.supported : null;
    verifyNote = verify.value.reason;

    steps.push({
      step: "VERIFY",
      kind: "model",
      ms: verify.ms,
      modelCalls: verify.value.checked ? 1 : 0,
      summary: !verify.value.checked
        ? `NOT CHECKED — ${verify.value.reason.slice(0, 60)}`
        : verify.value.supported
          ? `Supported — ${verify.value.reason.slice(0, 60)}`
          : `REJECTED — ${verify.value.reason.slice(0, 60)}`,
    });

    if (verify.value.checked && !verify.value.supported) {
      // A rejected diagnosis is not spoken. Rule 6, enforced by a second
      // opinion rather than by counting rows.
      state = {
        ...state,
        probableBelief: null,
        misconception: null,
        confidence: 0,
        intervention: null,
        insufficientEvidence: true,
        evidence: [
          ...state.evidence,
          `Verification rejected the diagnosis: ${verify.value.reason}`,
        ],
      };
    }
  } else {
    steps.push({
      step: "VERIFY",
      kind: "model",
      ms: 0,
      modelCalls: 0,
      summary: "Skipped",
      skipped: "No diagnosis to verify",
    });
    callsAvoided += 1;
  }

  steps.push({
    step: "INTERVENE",
    kind: "deterministic",
    ms: 0,
    modelCalls: 0,
    summary: `${state.nextAction} at rung ${state.hintLevel}`,
  });

  const trace = finish(input, steps, startedAt, modelCalls, callsAvoided, verified, verifyNote);
  void persist(input, trace);
  return { state, trace, recalled: recall.value.mistakes };
}

/**
 * The adversarial pass. It is given the evidence and the conclusion and
 * nothing else — deliberately not the reasoning that produced it, so it
 * cannot be talked into agreeing by a persuasive chain.
 */
async function verifyDiagnosis(
  events: Awaited<ReturnType<typeof recentEvents>>,
  state: ReasoningState,
  recalled: RecalledMistake[]
): Promise<{ supported: boolean; reason: string; checked: boolean }> {
  const SYSTEM = `You check a tutor's conclusions against the evidence. You are not the tutor and you are not trying to be helpful to the student — you are trying to catch the tutor being confidently wrong.

A conclusion is SUPPORTED only if the evidence given actually shows it. It is NOT supported when:
- the evidence is consistent with several different beliefs and the tutor picked one
- the belief is a restatement of the task rather than a claim about what the student thinks
- the tutor inferred a belief from a single observation
- the evidence describes what the student DID without showing why

Being unsupported is a normal, useful outcome. Say so plainly.

Reply with JSON only.`;

  const user = `== EVIDENCE THE TUTOR HAD ==
${eventsToTranscript(events)}
${recalled.length ? `\n== BELIEFS THIS STUDENT HAS SHOWN BEFORE ==\n${mistakesToContext(recalled)}` : ""}

== THE TUTOR'S CONCLUSION ==
probableBelief: ${state.probableBelief}
misconception: ${state.misconception}
confidence: ${state.confidence}

Is that conclusion supported by the evidence above? Reply with a JSON object of exactly {"supported": boolean, "reason": string} where reason is one sentence.`;

  try {
    const out = await llmJson<{ supported: boolean; reason: string }>(SYSTEM, user, {
      temperature: 0.1,
      maxTokens: 200,
      thinking: "off",
      // Same reason as lib/reasoning.ts: this pass runs inline while the
      // student waits, and it is the second call in a chain.
      provider: "openai",
    });
    return {
      supported: out.supported !== false,
      checked: true,
      reason: String(out.reason || "").slice(0, 200) || "No reason given.",
    };
  } catch (error) {
    // A failed check must not silently become a pass. It also must not block
    // the tutor, so the diagnosis still stands — but `checked: false` makes
    // the trace say "not checked" rather than "supported", which is the
    // difference between an honest trace and a decorative one.
    console.warn("[orchestrator] verify failed:", (error as Error).message);
    return {
      supported: true,
      checked: false,
      reason: `Not independently checked (${(error as Error).message.slice(0, 80)})`,
    };
  }
}

function finish(
  input: CouncilInput,
  steps: TraceStep[],
  startedAt: number,
  modelCalls: number,
  callsAvoided: number,
  verified: boolean | null,
  verifyNote: string | null
): OrchestratorTrace {
  return {
    sessionId: input.sessionId,
    steps,
    totalMs: Date.now() - startedAt,
    modelCalls,
    callsAvoided,
    verified,
    verifyNote,
  };
}

/** The trace is an event like everything else, so the strip can aggregate it. */
async function persist(input: CouncilInput, trace: OrchestratorTrace) {
  await recordEvent({
    sessionId: input.sessionId,
    userId: input.userId,
    type: "orchestrator_run",
    payload: {
      steps: trace.steps,
      totalMs: trace.totalMs,
      modelCalls: trace.modelCalls,
      callsAvoided: trace.callsAvoided,
      verified: trace.verified,
    },
  }).catch(() => undefined);
}
