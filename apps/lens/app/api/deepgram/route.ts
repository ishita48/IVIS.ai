/**
 * GET /api/deepgram
 *
 * Mints a short-lived Deepgram access token so the browser can open a
 * think-aloud transcription socket without ever seeing DEEPGRAM_API_KEY.
 *
 * Deepgram's grant endpoint (POST /v1/auth/grant, "Authorization: Token
 * <key>") returns a JWT that lives 30 seconds by default. The token only has
 * to be valid at the websocket handshake — the connection stays open after it
 * expires — so the client should fetch and connect in one motion.
 *
 * The key used here needs Member permissions in the Deepgram console; a
 * key without them gets a 403 from the grant call, which is passed through.
 *
 * Same shape as app/api/elevenlabs/signed-url/route.ts, which solves the
 * same problem for the other voice vendor. Nothing here is cacheable.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const LISTEN_URL = "wss://api.deepgram.com/v1/listen";

/** Seconds the token stays valid. Deepgram's default is 30; the ceiling is 3600. */
const TTL_SECONDS = 60;

export async function GET() {
  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPGRAM_API_KEY is not set in apps/lens/.env.local." },
      { status: 503 }
    );
  }

  let res: Response;
  try {
    res = await fetch(GRANT_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: TTL_SECONDS }),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Request to Deepgram failed." },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      {
        error: `Deepgram returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      },
      { status: 502 }
    );
  }

  const payload = (await res.json()) as Record<string, unknown>;
  const accessToken = payload.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    return NextResponse.json(
      { error: 'Deepgram response was missing "access_token".' },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      accessToken,
      expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : TTL_SECONDS,
      listenUrl: LISTEN_URL,
      model: process.env.DEEPGRAM_MODEL || "nova-3",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
