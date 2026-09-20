/**
 * The council, on the code surface.
 * ─────────────────────────────────────────────────────────────────────
 *
 * /api/code/check used to do this: run the code, and if it failed, ask a
 * model for a hint. One call, no memory, no check on what came back.
 *
 * That made the Code tab the only surface in LENS with no agents behind
 * it — the reasoning tab recalls what a student has believed before, gates
 * the expensive passes on it, and verifies its own diagnosis, and the
 * strongest proof surface in the product did none of that. This runs the
 * same shape over a failing test.
 *
 *   RECALL     free. kNN over lens-mistakes for what this student has
 *              already gotten wrong, across every surface — a belief
 *              formed at the camera comes back while they debug.
 *   GATE       free. If a prior belief matches above threshold, the hint
 *              is built from it and NO model runs. Two skipped calls go
 *              to the token ledger as real skips, not estimates.
 *   DIAGNOSE   the model, once, with the recalled beliefs as context so
 *              it can say "this is the third time" truthfully.
 *   VERIFY     the model, adversarially, against ONE question: does that
 *              hint give away the fix?
 *
 * VERIFY is the reason this file is worth its tokens. LENS's whole claim
 * is "a tutor that never gives you the answer", and until now that was
 * enforced by asking the model nicely in a system prompt. Prompts leak.
 * A second pass that reads the hint cold — without being told to be
 * helpful — and can reject it is the difference between a promise and a
 * control. A rejected hint is replaced by the failing case itself, which
 * was always the honest fallback.
 *
 * A failed VERIFY call reads NOT CHECKED and the hint is withheld. It
 * never reads "clean" on an error: the whole point is that the check
 * cannot be allowed to fail open.
 */

import type { HintLevel, TraceStep } from "./lens/contracts";
import { recallMistakes, type RecalledMistake } from "./mistakes";
import { elasticEnabled, hybridSearchElastic } from "./elastic";
import { recordSkip } from "./token-ledger";
import { llmJson } from "./llm";
import { GATE_CONFIDENCE } from "./orchestrator";
import type { BugFixture, CheckResult } from "./coding";

/**
 * How close a passage has to be before it is allowed to ground a hint.
 *
 * MEASURED, not guessed. Elastic rescales cosine to (1 + cos) / 2, so the
 * usable band runs 0.5 (unrelated) to 1.0 (identical) - the same rescaling
 * lib/mistakes.ts documents. Scored against the bug-01 divergence with one
 * source indexed at a time:
 *
 *   unrelated (French Revolution) ... no vector hit
 *   different topic (CSS flexbox) .. 0.540
 *   adjacent CS (array indexing) ... 0.635
 *   same concept (seeding a max) ... 0.696
 *
 * The line falls between 0.64 and 0.70, which is narrow, so this sits at
 * 0.68 - the same value mistakes.ts arrived at independently for "worth
 * mentioning" on the same scale. A first pass used 0.70 by reasoning
 * rather than measurement and rejected the one passage the feature exists
 * to find.
 *
 * Note this reads `vectorScore`, not `score`. The fused RRF score is
 * 1/(60+rank) - it orders results and says nothing about whether the top
 * one is any good, so thresholding on it would admit anything whenever
 * the student had any sources at all.
 */
const GROUND_FLOOR = 0.68;

export type Citation = {
  title: string;
  kind: string;
  url: string | null;
  quote: string;
  score: number;
};

export type CodeCouncil = {
  citation: Citation | null;
  hint: string | null;
  rung: HintLevel;
  steps: TraceStep[];
  modelCalls: number;
  callsAvoided: number;
  /** Null when the verifier could not be reached — never silently true. */
  verified: boolean | null;
  verifyNote: string | null;
  gated: boolean;
  recalled: {
    belief: string;
    surface: string;
    occurrences: number;
    score: number;
  }[];
};

const DIAGNOSE_SYSTEM = `You are LENS helping a student debug their own code. You never give the fix.

You are told the real failing input, what the program produced, what it should have produced, and privately why. Your job is to name the smallest next thing worth their attention at the rung you are given — and nothing beyond it.

POINT      name the line or expression to look at. No reason given.
ASK        one question they can answer by reading their own code.
NUDGE      one sentence naming the concept in play, not applied to their code.
EXPERIMENT suggest one small change to try and what to watch. Never the correct change.
EXPLAIN    teach the underlying idea properly. Still never write their fix.

You never paste corrected code, never state the corrected value or operator, and never say "change X to Y". If the rung is POINT you say less than you want to.`;

/**
 * The adversarial pass. Deliberately not told that the hint is supposed to
 * be good, or that a tutor wrote it — a verifier primed to approve
 * approves.
 */
const VERIFY_SYSTEM = `You audit tutoring hints for answer leakage. You are strict and you are not trying to be helpful to the hint's author.

You get a buggy program, its real cause, and a hint. Decide one thing: could a student apply the fix from the hint alone, without understanding the bug?

Leaking: naming the corrected operator, value, or bound; saying "change X to Y"; writing corrected code; stating the cause as a fact they can act on verbatim.
Not leaking: naming a line to look at; asking a question; naming the concept; suggesting an experiment whose outcome is not given.

Answer in json as {"leaks": boolean, "why": string} where why is at most 12 words.`;

/**
 * Retrieve from the student's OWN sources - the PDFs, slides and notes
 * they uploaded - and return the one passage worth teaching from.
 *
 * This is what makes the editor a tutoring surface rather than a judge.
 * The checker says the code is wrong; this says "your own lecture notes
 * cover exactly this, here". Retrieval is Elastic's hybrid RRF over BM25
 * and kNN, already built in lib/elastic.ts and already scoped to one user.
 *
 * Returning null is the common and correct outcome. A student with no
 * sources, or none about this bug, gets no citation rather than a
 * confident quote from something unrelated.
 */
async function groundInSources(
  userId: string,
  query: string
): Promise<Citation | null> {
  if (!elasticEnabled()) return null;

  const hits = (await hybridSearchElastic({ userId, query, k: 4 }).catch(
    () => []
  )) as Array<Record<string, unknown>>;

  for (const h of hits) {
    const score = Number(h.vectorScore ?? 0);
    if (!Number.isFinite(score) || score < GROUND_FLOOR) continue;
    const text = String(h.text ?? "").trim();
    if (text.length < 40) continue;
    return {
      title: String(h.title || "Untitled"),
      kind: String(h.kind || "source"),
      url: (h.url as string) || null,
      quote: trimToSentence(text, 260),
      score,
    };
  }
  return null;
}

/** Cut at a sentence end so a quote never stops mid-word. */
function trimToSentence(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd() + "…").trim();
}

/** The query that decides what gets recalled. */
function evidenceQuery(fixture: BugFixture, check: CheckResult): string {
  return `${fixture.problem} — on ${check.input} produced ${
    check.actual || check.stderr || "an error"
  } instead of ${check.expected}`.slice(0, 500);
}

/**
 * A hint built with no model at all, from a belief this student has
 * already demonstrated.
 *
 * Phrased from `belief` — what they appear to think — and never from
 * `rootCause`, which is the answer and stays server-side exactly as it
 * does everywhere else. The rung still caps it: at POINT this says less
 * than at EXPLAIN.
 */
function hintFromMemory(m: RecalledMistake, rung: HintLevel): string {
  const times = m.occurrences > 1 ? `${m.occurrences} times` : "before";
  switch (rung) {
    case "OBSERVE":
    case "POINT":
      return `You've hit this same idea ${times}, over in ${m.surface}. Look there first.`;
    case "ASK":
      return `This is the same shape as something you worked through ${times} in ${m.surface}. What did it turn out to hinge on?`;
    case "NUDGE":
      return `LENS has seen you reason this way ${times}: ${m.belief} The concept is the same one here.`;
    case "EXPERIMENT":
      return `You've met this ${times} already (${m.surface}). Try the smallest input where your version and the expected answer differ, and watch which one moves.`;
    default:
      return `This is the same belief you showed ${times} in ${m.surface}: ${m.belief} It is worth settling properly rather than patching this one case.`;
  }
}

/**
 * Read a hint cold and decide whether it hands over the fix.
 *
 * Separate and exported so it can be exercised directly against known-leaky
 * and known-safe hints. A guardrail nobody can test is a guardrail nobody
 * should trust, and this one is load-bearing for the product's only real
 * claim.
 *
 * Returns `verified: null` when the audit could not run. Callers must treat
 * that as "unknown" and withhold the hint - never as a pass.
 */
export async function auditHint(input: {
  source: string;
  rootCause: string;
  hint: string;
}): Promise<{ verified: boolean | null; note: string | null }> {
  try {
    const audit = await llmJson<{ leaks: boolean; why: string }>(
      VERIFY_SYSTEM,
      `Program:
${input.source.slice(0, 1200)}

Real cause: ${input.rootCause}

Hint to audit: "${input.hint}"

Reply as json.`,
      { temperature: 0, maxTokens: 120, thinking: "off", provider: "openai" }
    );
    return {
      verified: audit?.leaks !== true,
      note: String(audit?.why || "").trim().slice(0, 120) || null,
    };
  } catch {
    return { verified: null, note: "The audit could not run" };
  }
}

export async function runCodeCouncil(input: {
  fixture: BugFixture;
  check: CheckResult;
  source: string;
  rung: HintLevel;
  attempts: number;
  sessionId: string;
  userId: string;
}): Promise<CodeCouncil> {
  const { fixture, check, rung } = input;
  const steps: TraceStep[] = [];
  let modelCalls = 0;
  let callsAvoided = 0;

  // ── RECALL — free ──────────────────────────────────────────────────
  const t0 = Date.now();
  const query = evidenceQuery(fixture, check);
  const [recalled, citation] = await Promise.all([
    recallMistakes({ userId: input.userId, query, k: 3 }).catch(
      () => [] as RecalledMistake[]
    ),
    groundInSources(input.userId, query).catch(() => null),
  ]);

  steps.push({
    step: "RECALL",
    kind: "deterministic",
    ms: Date.now() - t0,
    modelCalls: 0,
    summary: recalled.length
      ? `${recalled.length} prior belief(s), closest ${recalled[0].score.toFixed(2)} from ${recalled[0].surface}`
      : "No prior belief close enough to reuse",
  });

  steps.push({
    step: "GROUND",
    kind: "deterministic",
    ms: 0,
    modelCalls: 0,
    summary: citation
      ? `"${citation.title}" matched at ${citation.score.toFixed(2)} — teaching from it`
      : "No source of yours covers this closely enough to quote",
  });

  const asRecalled = recalled.map((m) => ({
    belief: m.belief,
    surface: m.surface,
    occurrences: m.occurrences,
    score: m.score,
  }));

  // ── GATE — free, and decides whether anything else runs ────────────
  const strongest = recalled[0];
  // One real attempt, so the gate reuses memory about a student who has
  // actually tried something rather than about their opening run.
  const gateFires = !!strongest && strongest.score >= GATE_CONFIDENCE && input.attempts >= 1;

  if (gateFires) {
    callsAvoided += 2;
    for (const purpose of ["code.diagnose", "code.verify"]) {
      void recordSkip({
        scope: { sessionId: input.sessionId, userId: input.userId },
        purpose,
        concept: fixture.id,
        reason: `RECALL matched a known belief at ${strongest.score.toFixed(2)}`,
        provider: "openai",
      });
    }

    steps.push({
      step: "GATE",
      kind: "deterministic",
      ms: 0,
      modelCalls: 0,
      summary: `Known belief at ${strongest.score.toFixed(2)} — reusing it, no model call needed`,
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
      skipped: "Nothing generated to audit — the hint came from memory, not a model",
    });

    return {
      hint: hintFromMemory(strongest, rung),
      rung,
      steps,
      modelCalls,
      callsAvoided,
      verified: null,
      verifyNote: null,
      gated: true,
      recalled: asRecalled,
      citation,
    };
  }

  steps.push({
    step: "GATE",
    kind: "deterministic",
    ms: 0,
    modelCalls: 0,
    summary: strongest
      ? `Closest belief only ${strongest.score.toFixed(2)}, below ${GATE_CONFIDENCE} — running the model`
      : "Nothing to reuse — running the model",
  });

  // ── DIAGNOSE — the model, once ─────────────────────────────────────
  const history = recalled.length
    ? `\nThis student has previously shown these beliefs (use to connect, never to accuse):\n${recalled
        .map((m) => `- ${m.belief} (${m.surface}, ${m.occurrences}×)`)
        .join("\n")}`
    : "";

  const material = citation
    ? `

From this student's own material — "${citation.title}" (${citation.kind}):
"${citation.quote}"
If and only if it is genuinely about this bug, ground your hint in it and refer to it as their own notes. If it is not relevant, ignore it entirely and set usedSource false.`
    : "";

  const t1 = Date.now();
  let hint: string | null = null;
  let usedSource = false;
  try {
    const out = await llmJson<{ hint: string; usedSource?: boolean }>(
      DIAGNOSE_SYSTEM,
      `Problem: ${fixture.problem}

Their code:
${input.source.slice(0, 2000)}

The checker ran it. On input ${check.input} it produced ${
        check.actual || "(an error)"
      } where ${check.expected} was expected.${
        check.stderr ? `\nRuntime error: ${check.stderr}` : ""
      }${history}${material}

PRIVATE — the actual cause, which you must NOT state: ${fixture.rootCause}

Rung: ${rung}. Reply as JSON {"hint": string, "usedSource": boolean}, one or two sentences.`,
      { temperature: 0.3, maxTokens: 220, thinking: "off", provider: "openai" }
    );
    hint = String(out?.hint || "").trim() || null;
    usedSource = !!citation && out?.usedSource === true;
    modelCalls++;
  } catch {
    hint = null;
  }

  steps.push({
    step: "DIAGNOSE",
    kind: "model",
    ms: Date.now() - t1,
    modelCalls: hint ? 1 : 0,
    summary: hint
      ? `Hint drafted at rung ${rung}${usedSource ? `, from "${citation!.title}"` : ""}`
      : "No hint — the model call failed",
    skipped: hint ? null : "The failing case stands on its own",
  });

  if (!hint) {
    return {
      hint: null,
      rung,
      steps,
      modelCalls,
      callsAvoided,
      verified: null,
      verifyNote: null,
      gated: false,
      recalled: asRecalled,
      citation,
    };
  }

  // ── VERIFY — adversarial, and allowed to reject ────────────────────
  const t2 = Date.now();
  const audit = await auditHint({
    source: input.source,
    rootCause: fixture.rootCause,
    hint,
  });
  const verified = audit.verified;
  const verifyNote = audit.note;
  if (verified !== null) modelCalls++;

  if (verified === false) {
    steps.push({
      step: "VERIFY",
      kind: "model",
      ms: Date.now() - t2,
      modelCalls: 1,
      summary: `REJECTED — ${verifyNote || "gives away the fix"}`,
    });
    return {
      hint: null,
      rung,
      steps,
      modelCalls,
      callsAvoided,
      verified,
      verifyNote,
      gated: false,
      recalled: asRecalled,
      citation: null,
    };
  }

  if (verified === null) {
    steps.push({
      step: "VERIFY",
      kind: "model",
      ms: Date.now() - t2,
      modelCalls: 0,
      summary: "NOT CHECKED — the audit could not run, so the hint is withheld",
    });
    return {
      hint: null,
      rung,
      steps,
      modelCalls,
      callsAvoided,
      verified,
      verifyNote,
      gated: false,
      recalled: asRecalled,
      citation: null,
    };
  }

  steps.push({
    step: "VERIFY",
    kind: "model",
    ms: Date.now() - t2,
    modelCalls: 1,
    summary: `Clean — ${verifyNote || "states no fix"}`,
  });

  return {
    hint,
    rung,
    steps,
    modelCalls,
    callsAvoided,
    verified,
    verifyNote,
    gated: false,
    recalled: asRecalled,
    // Only claimed when the model says it actually taught from the passage.
    citation: usedSource ? citation : null,
  };
}
