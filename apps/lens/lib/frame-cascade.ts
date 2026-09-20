/**
 * LENS skips identical frames.
 * It skips frames marked unchanged by the client.
 * It throttles repeated objectives within the call window.
 */

import { createHash } from "node:crypto";
import { recordSkip, type LedgerScope } from "./token-ledger";

export type SkipReason = "unchanged_frame" | "scene_unchanged" | "throttled";

export type CascadeInput = {
  scope: LedgerScope;
  objective: string;
  frameDataUrl: string;
  sceneChanged?: boolean;
  force?: boolean;
  now?: number;
};

export type CascadeDecision<T> = { skip: false } | { skip: true; reason: SkipReason; prior: T };

export const DEFAULT_THROTTLE_MS = 4000;

type Entry = {
  objective: string;
  frameHash: string;
  observation: unknown;
  lastCallAt: number;
};

const entries = new Map<string, Entry>();

export function throttleMs(): number {
  const parsed = Number.parseInt(process.env.LENS_VISION_THROTTLE_MS ?? "", 10);
  return Number.isNaN(parsed) || parsed < 0 ? DEFAULT_THROTTLE_MS : parsed;
}

export function hashFrame(dataUrl: string): string {
  return createHash("sha1").update(dataUrl).digest("hex");
}

export function decideCascade<T>(input: CascadeInput): CascadeDecision<T> {
  if (input.force === true) return { skip: false };

  const entry = entries.get(input.scope.sessionId);
  const objective = input.objective.trim();
  if (!entry || entry.objective.trim() !== objective) return { skip: false };

  const now = input.now ?? Date.now();
  const frameHash = hashFrame(input.frameDataUrl);
  let reason: SkipReason | null = null;
  if (frameHash === entry.frameHash) reason = "unchanged_frame";
  else if (input.sceneChanged === false) reason = "scene_unchanged";
  else if (now - entry.lastCallAt < throttleMs()) reason = "throttled";

  if (!reason) return { skip: false };

  void recordSkip({
    scope: input.scope,
    provider: "openai",
    purpose: "vision.analyze",
    reason,
  });
  return { skip: true, reason, prior: entry.observation as T };
}

export function rememberAnalysis<T>(input: {
  scope: LedgerScope;
  objective: string;
  frameDataUrl: string;
  observation: T;
  now?: number;
}): void {
  const sessionId = input.scope.sessionId;
  entries.delete(sessionId);
  entries.set(sessionId, {
    objective: input.objective.trim(),
    frameHash: hashFrame(input.frameDataUrl),
    observation: input.observation,
    lastCallAt: input.now ?? Date.now(),
  });

  if (entries.size > 64) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
}

export function resetCascade(): void {
  entries.clear();
}
