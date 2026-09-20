/**
 * GET /api/elevenlabs/signed-url
 *
 * Mints short-lived credentials so the browser can open a conversation with
 * the LENS agent without ever seeing ELEVENLABS_API_KEY.
 *
 * Two credentials, because the two transports want different things:
 *   - WebRTC     → conversationToken  (GET /v1/convai/conversation/token)
 *   - WebSocket  → signedUrl          (GET /v1/convai/conversation/get-signed-url)
 *
 * We mint both in one round trip and let the client prefer WebRTC, falling
 * back to WebSocket if the peer connection cannot be established. Either
 * credential alone is enough to start a session, so a failure on one side is
 * reported but not fatal.
 *
 * Both credentials are short-lived (the signed URL expires after ~15 minutes).
 * Nothing here is cacheable.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_BASE = "https://api.elevenlabs.io/v1/convai/conversation";

/**
 * Characters left below which the session is not worth starting.
 *
 * ElevenLabs still mints a perfectly valid signed URL when the character
 * quota is spent — the socket connects, the agent joins, and then the first
 * attempt to speak 401s inside the SDK. What the student sees is
 * "Server error: Unknown error {}" followed by "could not createOffer with
 * closed peer connection", which names neither the cause nor the fix.
 *
 * So the quota is checked BEFORE the credential is handed out, and an
 * exhausted account is reported as exactly that. One extra request, and it
 * turns an inscrutable dead session into a sentence.
 */
const MIN_CHARS = 200;

async function quotaCheck(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null; // cannot tell — do not block on a guess
    const sub = (await res.json()) as {
      character_count?: number;
      character_limit?: number;
      tier?: string;
    };
    const used = Number(sub.character_count);
    const limit = Number(sub.character_limit);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;

    const left = limit - used;
    if (left <= MIN_CHARS) {
      return `ElevenLabs is out of characters — ${left.toLocaleString()} left of ${limit.toLocaleString()} on the ${sub.tier ?? "current"} plan. The voice tutor cannot speak until the quota resets or the plan is upgraded. Everything else (vision, pointer, reasoning) still works.`;
    }
    return null;
  } catch {
    return null; // a failed check must not block a working session
  }
}

type Minted = { value: string | null; error: string | null };

async function mint(url: string, apiKey: string, field: string): Promise<Minted> {
  try {
    const res = await fetch(url, {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        value: null,
        error: `ElevenLabs returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      };
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const value = payload[field];
    return typeof value === "string" && value
      ? { value, error: null }
      : { value: null, error: `ElevenLabs response was missing "${field}".` };
  } catch (err) {
    return {
      value: null,
      error: err instanceof Error ? err.message : "Request to ElevenLabs failed.",
    };
  }
}

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;

  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set in apps/lens/.env.local." },
      { status: 503 }
    );
  }

  if (!agentId) {
    return NextResponse.json(
      {
        error:
          "NEXT_PUBLIC_ELEVENLABS_AGENT_ID is not set. Create the LENS agent in the ElevenLabs dashboard and put its id in apps/lens/.env.local.",
      },
      { status: 503 }
    );
  }

  // Refuse before minting, not after the socket dies.
  const exhausted = await quotaCheck(apiKey);
  if (exhausted) {
    return NextResponse.json({ error: exhausted, reason: "quota_exceeded" }, { status: 402 });
  }

  const query = `agent_id=${encodeURIComponent(agentId)}`;

  const [webrtc, websocket] = await Promise.all([
    mint(`${API_BASE}/token?${query}`, apiKey, "token"),
    mint(`${API_BASE}/get-signed-url?${query}`, apiKey, "signed_url"),
  ]);

  if (!webrtc.value && !websocket.value) {
    return NextResponse.json(
      {
        error:
          "Could not mint an ElevenLabs conversation credential. " +
          [webrtc.error, websocket.error].filter(Boolean).join(" / "),
      },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      agentId,
      // Preferred transport.
      conversationToken: webrtc.value,
      // Fallback transport.
      signedUrl: websocket.value,
      // Non-fatal detail, so the UI can say which transport is unavailable.
      warnings: [webrtc.error, websocket.error].filter(Boolean) as string[],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
