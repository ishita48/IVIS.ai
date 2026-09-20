/**
 * LENS Token Ledger — every model call, and every call declined, as an event.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The metrics strip wants to say "eleven model calls skipped" and "N tokens
 * spent". Those are only worth saying if they are query results, so the
 * ledger is not a counter: each entry is a row in the same `events`
 * collection everything else in the demo is computed from, and
 * `computeMetrics` in `lib/metrics.ts` aggregates it back out.
 *
 * Two entry points:
 *
 *   recordCall()  — a provider was actually called. Written at the call
 *                   site, after the response, with the usage the provider
 *                   reported. Failed attempts are recorded too (ok: false),
 *                   because a fallback that tries Gemini and then OpenAI
 *                   spent two calls, not one.
 *   recordSkip()  — a call was deliberately not made. Nothing in `apps/lens`
 *                   calls this yet; the product decision about when to skip
 *                   belongs to a human. Until then `modelCallsSkipped` reads 0.
 *
 * Both are best-effort. A ledger write must never fail the request that
 * produced it, so both swallow persistence errors and warn.
 *
 * Ledger rows are excluded from `recentEvents()` so the reasoning prompt
 * never sees its own bill as evidence.
 */

import { recordEvent } from "./events";
import type { LensEventType } from "./lens/contracts";

/** Which session and student a model call is billed to. */
export type LedgerScope = {
  sessionId: string;
  userId: string;
};

export type ModelProvider = "openai" | "anthropic" | "gemini";

export const MODEL_CALL: LensEventType = "model_call";
export const MODEL_CALL_SKIPPED: LensEventType = "model_call_skipped";

/** Event types that belong to the ledger, not to the student's story. */
export const LEDGER_EVENT_TYPES: LensEventType[] = [MODEL_CALL, MODEL_CALL_SKIPPED];

export type RecordCallInput = {
  /** Absent when the caller has no session — the call is then not ledgered. */
  scope?: LedgerScope | null;
  provider: ModelProvider;
  model: string;
  /** Which feature paid for it, e.g. "vision.analyze", "llm.json". */
  purpose: string;
  /** Prompt tokens as the provider reported them. Null when it reported none. */
  tokensIn?: number | null;
  /** Completion tokens as the provider reported them. Null when it reported none. */
  tokensOut?: number | null;
  latencyMs?: number;
  /** False when the provider errored. Still a call; still spent. */
  ok?: boolean;
  concept?: string | null;
};

export type RecordSkipInput = {
  scope?: LedgerScope | null;
  /** The provider that would have been called. */
  provider?: ModelProvider | null;
  purpose: string;
  /** Why the call was not made, e.g. "cached", "unchanged_frame". */
  reason: string;
  /** Best estimate of what the skipped call would have cost, when known. */
  tokensSaved?: number | null;
  concept?: string | null;
};

export type ModelUsage = {
  tokensIn: number | null;
  tokensOut: number | null;
};

export async function recordCall(input: RecordCallInput): Promise<string | null> {
  if (!input.scope) return null;
  try {
    return await recordEvent({
      sessionId: input.scope.sessionId,
      userId: input.scope.userId,
      type: MODEL_CALL,
      concept: input.concept ?? null,
      payload: {
        provider: input.provider,
        model: input.model,
        purpose: input.purpose,
        tokensIn: finiteOrNull(input.tokensIn),
        tokensOut: finiteOrNull(input.tokensOut),
        latencyMs: finiteOrNull(input.latencyMs),
        ok: input.ok ?? true,
      },
    });
  } catch (error) {
    console.warn("[token-ledger] call not persisted:", (error as Error).message);
    return null;
  }
}

export async function recordSkip(input: RecordSkipInput): Promise<string | null> {
  if (!input.scope) return null;
  try {
    return await recordEvent({
      sessionId: input.scope.sessionId,
      userId: input.scope.userId,
      type: MODEL_CALL_SKIPPED,
      concept: input.concept ?? null,
      payload: {
        provider: input.provider ?? null,
        purpose: input.purpose,
        reason: input.reason,
        tokensSaved: finiteOrNull(input.tokensSaved),
      },
    });
  } catch (error) {
    console.warn("[token-ledger] skip not persisted:", (error as Error).message);
    return null;
  }
}

/** OpenAI chat completions and embeddings both report `usage` this way. */
export function openaiUsage(usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
} | null): ModelUsage {
  return {
    tokensIn: finiteOrNull(usage?.prompt_tokens),
    tokensOut: finiteOrNull(usage?.completion_tokens),
  };
}

/** Anthropic Messages API `usage` block. */
export function anthropicUsage(usage?: {
  input_tokens?: number;
  output_tokens?: number;
} | null): ModelUsage {
  return {
    tokensIn: finiteOrNull(usage?.input_tokens),
    tokensOut: finiteOrNull(usage?.output_tokens),
  };
}

/** Gemini `usageMetadata` on a GenerateContentResponse. */
export function geminiUsage(usage?: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
} | null): ModelUsage {
  return {
    tokensIn: finiteOrNull(usage?.promptTokenCount),
    tokensOut: finiteOrNull(usage?.candidatesTokenCount),
  };
}

/** Sum of what a ledger row says was spent. Rows with no usage count 0. */
export function tokensInRow(payload: Record<string, unknown> | undefined): number {
  const tokensIn = Number(payload?.tokensIn);
  const tokensOut = Number(payload?.tokensOut);
  return (Number.isFinite(tokensIn) ? tokensIn : 0) + (Number.isFinite(tokensOut) ? tokensOut : 0);
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n) ? null : n;
}
