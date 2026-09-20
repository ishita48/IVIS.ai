/**
 * Who is calling, and may they spend money.
 *
 * Every route the camera needs checks for a Clerk session, so a judge
 * without an account gets 401 on Analyze. This
 * module is the one place that decides instead. A signed-in user resolves
 * exactly as before. With DEMO_MODE=1, a bearer token minted by
 * POST /api/demo/token also resolves, as a `demo:<id>` user, so events still
 * record against a session.
 *
 * Tokens are HMAC-SHA256 over `<id>.<expiresAt>` with DEMO_TOKEN_SECRET.
 * They live 30 minutes. Two caps, both in process memory, both env-tunable:
 *
 *   DEMO_MAX_ANALYSES_PER_TOKEN   gated calls one token may make   (default 20)
 *   DEMO_MAX_TOKENS_PER_IP_HOUR   tokens one IP may mint per hour  (default 5)
 *
 * Memory means the caps reset on deploy and are per instance. For one demo
 * laptop that is the right trade; for anything bigger, move the counters.
 *
 * Off by default: with DEMO_MODE unset, no token is minted and no token is
 * honoured, and the routes behave byte-for-byte as they did.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { auth } from "@clerk/nextjs/server";

export const DEMO_TOKEN_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_ANALYSES_PER_TOKEN = 20;
export const DEFAULT_MAX_TOKENS_PER_IP_HOUR = 5;

const HOUR_MS = 60 * 60 * 1000;
const DEMO_PREFIX = "demo:";

export type Caller = { userId: string; demo: boolean };

type DemoEnv = Record<string, string | undefined>;

export type DemoLimits = {
  maxAnalysesPerToken: number;
  maxTokensPerIpHour: number;
};

export function demoModeEnabled(env: DemoEnv = process.env): boolean {
  return env.DEMO_MODE === "1";
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function demoLimits(env: DemoEnv = process.env): DemoLimits {
  return {
    maxAnalysesPerToken: positiveInt(env.DEMO_MAX_ANALYSES_PER_TOKEN, DEFAULT_MAX_ANALYSES_PER_TOKEN),
    maxTokensPerIpHour: positiveInt(env.DEMO_MAX_TOKENS_PER_IP_HOUR, DEFAULT_MAX_TOKENS_PER_IP_HOUR),
  };
}

function secret(env: DemoEnv): string | null {
  const s = env.DEMO_TOKEN_SECRET;
  return s && s.length >= 16 ? s : null;
}

function sign(id: string, expiresAt: number, key: string): string {
  return createHmac("sha256", key).update(`${id}.${expiresAt}`).digest("base64url");
}

export type DemoToken = { token: string; id: string; expiresAt: number };

/** Mint a token. Returns null when demo mode is off or the secret is missing. */
export function signDemoToken(
  now: number = Date.now(),
  env: DemoEnv = process.env
): DemoToken | null {
  const key = secret(env);
  if (!demoModeEnabled(env) || !key) return null;
  const id = randomBytes(9).toString("base64url");
  const expiresAt = now + DEMO_TOKEN_TTL_MS;
  return { token: `${id}.${expiresAt}.${sign(id, expiresAt, key)}`, id, expiresAt };
}

/** Check signature and expiry. Returns the token id, or null. Off means null. */
export function verifyDemoToken(
  token: string,
  now: number = Date.now(),
  env: DemoEnv = process.env
): { id: string; expiresAt: number } | null {
  const key = secret(env);
  if (!demoModeEnabled(env) || !key) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, expRaw, sig] = parts;
  const expiresAt = Number(expRaw);
  if (!id || !Number.isInteger(expiresAt) || !sig) return null;
  if (expiresAt <= now) return null;

  const expected = Buffer.from(sign(id, expiresAt, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { id, expiresAt };
}

// ── In-memory caps ────────────────────────────────────────────────────

const analysesByToken = new Map<string, { used: number; expiresAt: number }>();
const mintsByIp = new Map<string, number[]>();

function sweep(now: number) {
  for (const [id, entry] of analysesByToken) {
    if (entry.expiresAt <= now) analysesByToken.delete(id);
  }
  for (const [ip, stamps] of mintsByIp) {
    const live = stamps.filter((t) => t > now - HOUR_MS);
    if (live.length) mintsByIp.set(ip, live);
    else mintsByIp.delete(ip);
  }
}

/** Test hook. Clears every counter. */
export function resetDemoCaps() {
  analysesByToken.clear();
  mintsByIp.clear();
}

/** Record one mint for this IP. False when the hourly cap is already spent. */
export function allowMint(
  ip: string,
  now: number = Date.now(),
  limits: DemoLimits = demoLimits()
): boolean {
  sweep(now);
  const stamps = mintsByIp.get(ip) ?? [];
  if (stamps.length >= limits.maxTokensPerIpHour) return false;
  stamps.push(now);
  mintsByIp.set(ip, stamps);
  return true;
}

/** Spend one analysis on this token. False once the per-token cap is reached. */
export function consumeAnalysis(
  id: string,
  expiresAt: number,
  now: number = Date.now(),
  limits: DemoLimits = demoLimits()
): boolean {
  sweep(now);
  const entry = analysesByToken.get(id) ?? { used: 0, expiresAt };
  if (entry.used >= limits.maxAnalysesPerToken) return false;
  entry.used += 1;
  analysesByToken.set(id, entry);
  return true;
}

export function analysesRemaining(id: string, limits: DemoLimits = demoLimits()): number {
  return Math.max(0, limits.maxAnalysesPerToken - (analysesByToken.get(id)?.used ?? 0));
}

// ── Request-level resolution ──────────────────────────────────────────

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1] : null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/**
 * The demo half of resolveCaller, with no Clerk in it so it can be tested.
 * Verifies the bearer token and spends one analysis. Null when the token is
 * missing, invalid, expired, exhausted, or demo mode is off.
 */
export function resolveDemoCaller(
  req: Request,
  now: number = Date.now(),
  env: DemoEnv = process.env
): Caller | null {
  const token = bearerToken(req);
  if (!token) return null;
  const verified = verifyDemoToken(token, now, env);
  if (!verified) return null;
  if (!consumeAnalysis(verified.id, verified.expiresAt, now, demoLimits(env))) return null;
  return { userId: `${DEMO_PREFIX}${verified.id}`, demo: true };
}

/**
 * Clerk session first, demo token second, else null. A signed-in user gets
 * the same `userId` the routes read today; nothing else about that path
 * changes.
 */
export async function resolveCaller(req: Request): Promise<Caller | null> {
  const { userId } = await auth();
  if (userId) return { userId, demo: false };
  return resolveDemoCaller(req);
}
