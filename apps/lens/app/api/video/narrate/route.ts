/**
 * POST /api/video/narrate — turn a storyboard into something that plays.
 *
 * The video tool used to return a script: headings, narration text, a
 * transcript. That is a document about a video, not a video. This
 * synthesises each scene's narration with ElevenLabs and hands back audio
 * the player can run in sequence, so the thing the student asked for
 * actually plays.
 *
 * Scenes are narrated in parallel — they are independent, and doing them
 * one after another makes a six-scene summary take six times longer than
 * it needs to for no benefit.
 *
 * Cloudinary is optional. With it, each scene's audio is uploaded once and
 * replays stream from a CDN; without it the audio comes back inline as a
 * data URI from this same response. The feature does not change shape
 * either way, which is the point — a missing key must not be able to break
 * a demo.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { cloudinaryConfigured, narrationId, uploadAudio } from "@/lib/cloudinary";

export const runtime = "nodejs";
export const maxDuration = 120;

const VOICE = () => process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const TTS_MODEL = () => process.env.ELEVENLABS_TTS_MODEL || "eleven_turbo_v2_5";

/** Cap the work: a summary longer than this is a lecture, not a summary. */
const MAX_SCENES = 10;
const MAX_CHARS = 1200;

type NarratedScene = {
  index: number;
  /** CDN url when Cloudinary is configured, else an inline data: URI. */
  audioUrl: string;
  bytes: number;
  durationSec: number | null;
  cached: boolean;
  error?: string;
};

async function synthesise(text: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set.");

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE()}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: TTS_MODEL(),
        voice_settings: {
          // Steadier than the conversational agent's settings: a narrator
          // reading a prepared line should not wander the way a tutor
          // improvising a question should.
          stability: 0.55,
          similarity_boost: 0.75,
          speed: 0.97,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs returned ${res.status}: ${detail.slice(0, 160)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set — narration is offline." },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    scenes?: { narration?: string }[];
  };

  const scenes = (Array.isArray(body.scenes) ? body.scenes : [])
    .slice(0, MAX_SCENES)
    .map((s) => String(s?.narration || "").trim().slice(0, MAX_CHARS));

  if (!scenes.length || scenes.every((s) => !s)) {
    return NextResponse.json(
      { error: "No narration to speak." },
      { status: 400 }
    );
  }

  const sessionId = String(body.sessionId || "");
  const startedAt = Date.now();

  // Independent scenes, so they synthesise together. One failing scene
  // must not take the rest of the video with it — the player skips it and
  // shows the slide silently rather than refusing to start.
  const narrated: NarratedScene[] = await Promise.all(
    scenes.map(async (text, index): Promise<NarratedScene> => {
      if (!text) {
        return {
          index,
          audioUrl: "",
          bytes: 0,
          durationSec: 0,
          cached: false,
          error: "Empty narration",
        };
      }
      try {
        const audio = await synthesise(text);

        const hosted = await uploadAudio(audio, {
          publicId: narrationId(sessionId, index, text),
          contentType: "audio/mpeg",
        });

        if (hosted) {
          return {
            index,
            audioUrl: hosted.url,
            bytes: hosted.bytes,
            durationSec: hosted.durationSec,
            cached: true,
          };
        }

        return {
          index,
          audioUrl: `data:audio/mpeg;base64,${audio.toString("base64")}`,
          bytes: audio.length,
          durationSec: null,
          cached: false,
        };
      } catch (error) {
        return {
          index,
          audioUrl: "",
          bytes: 0,
          durationSec: null,
          cached: false,
          error: (error as Error).message.slice(0, 160),
        };
      }
    })
  );

  return NextResponse.json({
    scenes: narrated,
    hosted: cloudinaryConfigured(),
    latencyMs: Date.now() - startedAt,
    failed: narrated.filter((s) => s.error).length,
  });
}
