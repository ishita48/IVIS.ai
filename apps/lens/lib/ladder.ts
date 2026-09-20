/**
 * The hint ladder's pacing, as pure functions over the event log.
 *
 * Two questions live here, and both exist because the failure mode of a
 * tutor that only asks is a tutor that asks the same thing over and over:
 *
 *   1. `nextAllowedLevel` — how far up the ladder LENS may go right now.
 *      One rung per genuine student attempt. A prediction, a retry, and an
 *      answered check have always counted. A spoken reply to a question the
 *      tutor asked now counts too: once the student has answered — even
 *      with "I don't know" — the question has done its work, and the only
 *      honest next move is one rung up, not the same question again.
 *
 *   2. `askedQuestions` / `sameQuestion` — which questions the tutor has
 *      already put to the student, so neither the engine nor the voice
 *      agent re-asks one in slightly different words.
 *
 * Nothing here touches a database or a model, so it is fully unit-tested.
 */

import { HINT_LADDER, type HintLevel, type LensEvent } from "./lens/contracts";

/** Shortest spoken reply that counts as an answer rather than a noise. */
const MIN_REPLY_CHARS = 2;

const turnRole = (e: LensEvent): "user" | "agent" | null => {
  if (e.type !== "voice_turn") return null;
  const role = (e.payload as { role?: unknown })?.role;
  return role === "user" || role === "agent" ? role : null;
};

const turnText = (e: LensEvent): string => {
  const text = (e.payload as { text?: unknown })?.text;
  return typeof text === "string" ? text.trim() : "";
};

/** Whether an agent turn put a question to the student. */
export function isQuestion(text: string): boolean {
  return text.includes("?");
}

/**
 * Number of genuine attempts the student has made this session. Recorded
 * attempts (prediction, retry, answered check, completed experiment) count
 * one each. A spoken reply that follows a tutor question counts once per
 * question — several replies to the same question are still one attempt.
 */
export function countAttempts(events: LensEvent[]): number {
  let attempts = 0;
  let awaitingReply = false;
  for (const e of events) {
    if (
      e.type === "prediction" ||
      e.type === "retry" ||
      e.type === "understanding_check_answered" ||
      e.type === "experiment_completed"
    ) {
      attempts += 1;
      continue;
    }
    const role = turnRole(e);
    if (role === "agent") {
      awaitingReply = isQuestion(turnText(e));
    } else if (role === "user" && awaitingReply && turnText(e).length >= MIN_REPLY_CHARS) {
      attempts += 1;
      awaitingReply = false;
    }
  }
  return attempts;
}

/**
 * The furthest rung LENS is allowed to reach right now. Starts at POINT and
 * climbs one rung per attempt, which is why LENS visibly escalates during a
 * demo instead of front-loading an explanation on turn one — and why it
 * does not stall on one rung once the student has answered.
 */
export function nextAllowedLevel(events: LensEvent[]): HintLevel {
  return HINT_LADDER[Math.min(countAttempts(events) + 1, HINT_LADDER.length - 1)];
}

/** Lower-cased, punctuation-free, single-spaced — for comparing questions. */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when two questions are the same question. Exact after
 * normalisation, or one contains the other — "count each finger one by one"
 * and "count each finger one by one, what do you find?" are one question.
 */
export function sameQuestion(a: string, b: string): boolean {
  const na = normalizeQuestion(a);
  const nb = normalizeQuestion(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.length >= 20 && long.includes(short);
}

/** The questions the tutor has already asked, oldest first, most recent last. */
export function askedQuestions(events: LensEvent[], limit = 8): string[] {
  const asked: string[] = [];
  for (const e of events) {
    if (turnRole(e) !== "agent") continue;
    const text = turnText(e);
    if (isQuestion(text)) asked.push(text);
  }
  return asked.slice(-limit);
}

/** Whether the student has said anything since the given ISO timestamp. */
export function studentSpokeSince(events: LensEvent[], sinceIso: string | undefined): boolean {
  if (!sinceIso) return false;
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return false;
  return events.some(
    (e) => turnRole(e) === "user" && turnText(e).length >= MIN_REPLY_CHARS && Date.parse(e.timestamp) > since
  );
}
