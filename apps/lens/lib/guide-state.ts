/**
 * Guide state — the server half of "the voice agent can see what the
 * extension sees". /api/guide/step already writes a `guide_step` event per
 * turn; this module reads them back. A `read_guide_step` client tool in
 * hooks/useAgent.ts calls /api/guide/state so the ElevenLabs agent can
 * answer "what do I do next?" from the guide's own state.
 */

import { recentEvents } from "./events";
import type { LensEvent, GuideStatus } from "./lens/contracts";

export type GuideStateStep = {
  goal: string;
  step: string;
  why: string | null;
  status: GuideStatus;
  observation: string | null;
  target: { x: number; y: number } | null;
  index: number | null;
  pageUrl: string | null;
  /** When the step was recorded — the event's timestamp, ISO. */
  at: string;
};

export type GuideState = {
  latest: GuideStateStep | null;
  history: GuideStateStep[];
};

const GUIDE_STATUSES: GuideStatus[] = ["on_track", "off_track", "blocked", "done"];

const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);

/**
 * Pure: guide_step events (any order) -> steps, newest first. Rows whose
 * payload lacks a string `step` are skipped — a malformed row must not
 * become a step the agent reads aloud.
 */
export function guideStepsFromEvents(
  events: LensEvent[],
  userId?: string
): GuideStateStep[] {
  return events
    .filter(
      (e) =>
        e.type === "guide_step" &&
        (!userId || !e.userId || e.userId === userId)
    )
    .map((e) => {
      const p = e.payload;
      const x = p.x;
      const y = p.y;
      const status = p.status;
      return {
        goal: strOrNull(p.goal) ?? "",
        step: strOrNull(p.step),
        why: strOrNull(p.why),
        status: GUIDE_STATUSES.includes(status as GuideStatus)
          ? (status as GuideStatus)
          : "on_track",
        observation: strOrNull(p.observation),
        target:
          typeof x === "number" && typeof y === "number" ? { x, y } : null,
        index: numOrNull(p.index),
        pageUrl: strOrNull(p.pageUrl),
        at: e.timestamp,
      };
    })
    .filter((s): s is GuideStateStep => s.step !== null)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The last `limit` steps, newest first. The event log mixes types, so this
 * reads wide and slices after filtering.
 */
export async function guideHistory(
  sessionId: string,
  limit = 5,
  userId: string
): Promise<GuideStateStep[]> {
  const events = await recentEvents(sessionId, userId, 200);
  return guideStepsFromEvents(events, userId).slice(0, limit);
}

export async function latestGuideStep(
  sessionId: string,
  userId: string
): Promise<GuideStateStep | null> {
  const [latest] = await guideHistory(sessionId, 1, userId);
  return latest ?? null;
}

export async function guideState(
  sessionId: string,
  limit = 5,
  userId: string
): Promise<GuideState> {
  const history = await guideHistory(sessionId, limit, userId);
  return { latest: history[0] ?? null, history };
}
