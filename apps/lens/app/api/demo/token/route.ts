/**
 * POST /api/demo/token
 *
 * Mints a short-lived demo token so a judge can use /live without an
 * account. The client sends it as `Authorization: Bearer <token>` to
 * /api/vision/analyze, /api/pointer/screen and /api/guide/step, which
 * resolve it through lib/demo-access.ts.
 *
 * 404 unless DEMO_MODE=1, so on a normal deployment this route does not
 * exist. 503 if DEMO_MODE is on but DEMO_TOKEN_SECRET is missing or short.
 * 429 once an IP has minted DEMO_MAX_TOKENS_PER_IP_HOUR tokens in an hour.
 *
 * Caps and defaults are documented at the top of lib/demo-access.ts.
 */

import { NextResponse } from "next/server";
import {
  allowMint,
  clientIp,
  demoLimits,
  demoModeEnabled,
  DEMO_TOKEN_TTL_MS,
  signDemoToken,
} from "@/lib/demo-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!demoModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limits = demoLimits();
  const now = Date.now();

  const minted = signDemoToken(now);
  if (!minted) {
    return NextResponse.json(
      { error: "DEMO_TOKEN_SECRET is not set (16+ characters) in apps/lens/.env.local." },
      { status: 503 }
    );
  }

  if (!allowMint(clientIp(req), now, limits)) {
    return NextResponse.json(
      { error: `Demo token limit reached: ${limits.maxTokensPerIpHour} per hour.` },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  return NextResponse.json(
    {
      token: minted.token,
      expiresAt: new Date(minted.expiresAt).toISOString(),
      ttlSeconds: DEMO_TOKEN_TTL_MS / 1000,
      analysesAllowed: limits.maxAnalysesPerToken,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
