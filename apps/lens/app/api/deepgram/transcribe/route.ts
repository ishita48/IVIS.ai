/**
 * POST /api/deepgram/transcribe — think-aloud, transcribed.
 *
 * Takes one recorded clip and returns what was said. Used by the mic in the
 * workspace so a student can narrate while their hands are busy, which is
 * the whole gap this fills: `/live` is a spoken conversation, but `/app`
 * was typed-only, and the moment worth capturing is usually the one where
 * both hands are on the thing you are working on.
 *
 * WHY SERVER-SIDE, NOT A BROWSER WEBSOCKET
 * Deepgram's streaming API wants a credential in the browser, which means
 * either shipping the API key (never) or minting a short-lived one. Minting
 * needs the `keys:write` scope, and this account's key returns 403 for both
 * `/v1/auth/grant` and `POST /v1/projects/{id}/keys` — verified, not
 * assumed. So the audio comes here and the key never leaves the server.
 *
 * That trade is fine for this feature. Push-to-talk dictation does not want
 * interim results; it wants one accurate transcript when you let go, which
 * is exactly what the prerecorded endpoint returns.
 *
 * Distinct from the ElevenLabs agent's STT: that transcribes turns in a
 * conversation LENS is having. This transcribes the student thinking out
 * loud, and the result is theirs to edit before anything is sent.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Deepgram's current speech model. Tuned for conversational audio. */
const MODEL = process.env.DEEPGRAM_MODEL || "nova-3";

/** A minute of think-aloud is plenty; beyond that it is a lecture. */
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPGRAM_API_KEY is not set — dictation is offline." },
      { status: 503 }
    );
  }

  const contentType = req.headers.get("content-type") || "application/octet-stream";
  const audio = Buffer.from(await req.arrayBuffer());

  if (!audio.length) {
    return NextResponse.json({ error: "No audio received." }, { status: 400 });
  }
  if (audio.length > MAX_BYTES) {
    return NextResponse.json(
      { error: "That clip is too long — keep think-aloud under a minute." },
      { status: 413 }
    );
  }

  const params = new URLSearchParams({
    model: MODEL,
    smart_format: "true",
    punctuate: "true",
    // Filler words are the point here, not noise: "wait, no, actually..."
    // is the student changing their mind, and that is worth keeping.
    filler_words: "true",
  });

  const startedAt = Date.now();

  try {
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        // Pass the browser's own container type through — Chrome records
        // webm/opus, Safari mp4. Deepgram sniffs it either way, but being
        // explicit avoids a needless decode failure.
        "content-type": contentType,
      },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Deepgram returned ${res.status}: ${detail.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const payload = (await res.json()) as any;
    const alt = payload?.results?.channels?.[0]?.alternatives?.[0];
    const transcript = String(alt?.transcript || "").trim();

    return NextResponse.json({
      transcript,
      confidence: Number(alt?.confidence) || 0,
      durationSec: Number(payload?.metadata?.duration) || 0,
      latencyMs: Date.now() - startedAt,
      // Empty is a real answer — silence, or a clip with no speech in it.
      // The client says "didn't catch that" rather than sending nothing.
      empty: transcript.length === 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Transcription failed." },
      { status: 502 }
    );
  }
}
