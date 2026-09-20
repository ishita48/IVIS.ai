/**
 * LENS Metrics — computed, never counted in the UI.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 4 (Integrations & Infra).
 *
 * Every number the metrics strip shows a judge is an aggregation over the
 * real `events` and `reasoning_states` collections. If the strip says
 * "direct answers: 0", that is a query result, not a constant — which is
 * the only version of that claim worth making on stage.
 *
 * Do not present these as validated learning-science. It is a weekend of
 * data from one session, and saying so out loud is more credible than
 * pretending otherwise.
 */

import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import { EVENTS } from "./events";
import { REASONING_STATES } from "./reasoning";
import { elasticPrimary, searchElasticDocuments } from "./elastic";
import { MODEL_CALL, MODEL_CALL_SKIPPED, tokensInRow } from "./token-ledger";
import { HINT_LADDER, type HintLevel, type LensMetrics } from "./lens/contracts";

export async function computeMetrics(sessionId: string): Promise<LensMetrics> {
  const empty: LensMetrics = {
    directAnswersGiven: 0,
    hintsIssued: 0,
    deepestHintLevel: null,
    understandingChecksAsked: 0,
    understandingChecksCorrect: 0,
    misconceptionsDetected: 0,
    misconceptionsResolved: 0,
    experimentsRun: 0,
    voiceTurns: 0,
    visionCalls: 0,
    visionLatencyMsP50: null,
    visionLatencyMsP95: null,
    modelCallsAvoided: 0,
    diagnosesRejected: 0,
    modelCallsSkipped: 0,
    tokensSpent: 0,
  };
  if (!ObjectId.isValid(sessionId) && !elasticPrimary()) return empty;

  let events: any[];
  let states: any[];
  if (elasticPrimary()) {
    try {
      const [elasticEvents, elasticStates] = await Promise.all([
        searchElasticDocuments<any>("events", sessionId, 10000, true),
        searchElasticDocuments<any>("reasoning", sessionId, 10000, true),
      ]);
      if (elasticEvents && elasticStates) {
        events = elasticEvents;
        states = elasticStates;
      } else {
        throw new Error("Elastic metrics indices returned no result");
      }
    } catch (error) {
      console.warn("[metrics] Elastic read failed, falling back to Mongo:", (error as Error).message);
      ({ events, states } = await readMongoMetrics(sessionId));
    }
  } else {
    ({ events, states } = await readMongoMetrics(sessionId));
  }

  const visionEvents = events.filter((e: any) => e.type === "camera_frame_analyzed");
  const latencies = visionEvents
    .map((e: any) => Number(e.payload?.latencyMs))
    .filter((n: number) => Number.isFinite(n))
    .sort((a: number, b: number) => a - b);

  const checks = events.filter(
    (e: any) => e.type === "understanding_check_answered"
  );

  const runs = events.filter((e: any) => e.type === "orchestrator_run");

  // A misconception counts as resolved when a later state no longer carries
  // it — the core claim of the reasoning engine, made falsifiable.
  const named = states
    .map((s: any) => s.misconception)
    .filter(Boolean) as string[];
  const distinct = Array.from(new Set(named));
  const lastMisconception = states.length
    ? (states[states.length - 1] as any).misconception
    : null;
  const resolved = distinct.filter((m) => m !== lastMisconception).length;

  const deepest = events
    .filter((e: any) => e.type === "hint_requested")
    .map((e: any) => String(e.payload?.level || "") as HintLevel)
    .filter((l: HintLevel) => HINT_LADDER.includes(l))
    .sort((a, b) => HINT_LADDER.indexOf(b) - HINT_LADDER.indexOf(a))[0];

  return {
    // Counts frames where a model set shouldRevealAnswer. Should stay 0.
    directAnswersGiven: visionEvents.filter(
      (e: any) => e.payload?.shouldRevealAnswer === true
    ).length,
    hintsIssued: events.filter((e: any) => e.type === "hint_requested").length,
    deepestHintLevel: deepest ?? null,
    understandingChecksAsked: checks.length,
    understandingChecksCorrect: checks.filter((e: any) => e.payload?.correct === true)
      .length,
    misconceptionsDetected: distinct.length,
    misconceptionsResolved: resolved,
    experimentsRun: events.filter((e: any) => e.type === "experiment_completed")
      .length,
    voiceTurns: events.filter((e: any) => e.type === "voice_turn").length,
    visionCalls: visionEvents.length,
    visionLatencyMsP50: percentile(latencies, 0.5),
    visionLatencyMsP95: percentile(latencies, 0.95),
    modelCallsAvoided: runs.reduce(
      (sum: number, e: any) => sum + (Number(e.payload?.callsAvoided) || 0),
      0
    ),
    diagnosesRejected: runs.filter((e: any) => e.payload?.verified === false).length,
    // Ledger rows written by lib/token-ledger.ts. The orchestrator's GATE is
    // the real skip path this was waiting for — it calls recordSkip() when it
    // reuses a remembered belief, so this is no longer structurally zero.
    modelCallsSkipped: events.filter((e: any) => e.type === MODEL_CALL_SKIPPED).length,
    tokensSpent: events
      .filter((e: any) => e.type === MODEL_CALL)
      .reduce((sum: number, e: any) => sum + tokensInRow(e.payload), 0),
  };
}

async function readMongoMetrics(sessionId: string) {
  const db = await getDb();
  const sid = new ObjectId(sessionId);
  const [events, states] = await Promise.all([
    db.collection(EVENTS).find({ sessionId: sid }).sort({ timestamp: 1 }).toArray(),
    db.collection(REASONING_STATES).find({ sessionId: sid }).sort({ createdAt: 1 }).toArray(),
  ]);
  return { events, states };
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return Math.round(sorted[idx]);
}
