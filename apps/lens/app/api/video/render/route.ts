/**
 * POST /api/video/render — storyboard in, watchable video out.
 *
 * The full pipeline:
 *   1. Nano Banana draws one frame per scene (OpenAI images if Google's
 *      daily cap is spent — see lib/imagegen.ts).
 *   2. Each frame goes to Cloudinary.
 *   3. ElevenLabs narrates each scene.
 *   4. Cloudinary stitches the frames into one MP4 with the narration
 *      laid over it.
 *
 * Steps 2 and 4 need Cloudinary credentials. WITHOUT THEM THE ROUTE STILL
 * RETURNS A USABLE VIDEO: the frames come back as data URIs alongside the
 * per-scene audio, and the player composites them in the browser. That is
 * not a degraded mode bolted on afterwards — it is the path that runs
 * every time the keys are absent, and the one that was tested.
 *
 * `mp4Url` is therefore the *optional* part. Present, the student gets one
 * file they can scrub, download and send to someone. Absent, they still
 * get the video, it just lives in the page.
 *
 * MOTION MODE (`motion: true`) replaces the stills with real four-second
 * Sora clips, one per scene, so the diagram actually moves. Those jobs are
 * created in one burst and polled together — measured at 64s for three
 * clips against ~150s doing them one at a time, and the three landed
 * within two seconds of each other, so the cost is the slowest clip rather
 * than the sum. See lib/videogen.ts.
 *
 * Cost note: motion is by far the most expensive thing this product can
 * do, and stills are next (~33s a frame on gpt-image-1). Both are opt-in.
 * `withImages: false` and `motion: false` returns narration only, which is
 * what the player asks for on a replay.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  cloudinaryConfigured,
  cloudinaryCredentialProblem,
  narrationId,
  spliceClipsUrl,
  stitchSlideshow,
  uploadAudio,
  uploadClip,
  uploadImage,
} from "@/lib/cloudinary";
import { generateSceneImage, imagegenProviders } from "@/lib/imagegen";
import { generateSceneClips, videogenConfigured } from "@/lib/videogen";
import { recordEvent } from "@/lib/events";
import { resolveOrCreateSession } from "@/lib/session-helpers";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_SCENES = 8;

type RenderedScene = {
  index: number;
  imageUrl: string | null;
  /** A moving clip for this scene, when motion mode was asked for. */
  clipUrl: string | null;
  imageModel: string | null;
  audioUrl: string | null;
  durationSec: number | null;
  error?: string;
};

async function narrate(text: string): Promise<Buffer | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !text.trim()) return null;
  const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_turbo_v2_5",
          voice_settings: { stability: 0.55, similarity_boost: 0.75, speed: 0.97 },
        }),
        signal: AbortSignal.timeout(45_000),
      }
    );
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    title?: string;
    withImages?: boolean;
    /** Generate moving clips instead of stills. Slow and expensive. */
    motion?: boolean;
    scenes?: {
      heading?: string;
      narration?: string;
      keyTerm?: string;
      visualPrompt?: string;
      durationSec?: number;
    }[];
  };

  const scenes = (Array.isArray(body.scenes) ? body.scenes : []).slice(0, MAX_SCENES);
  if (!scenes.length) {
    return NextResponse.json({ error: "No scenes to render." }, { status: 400 });
  }

  const session = await resolveOrCreateSession(userId, body.sessionId, "LENS Session");
  const sessionId = String(session._id);
  const motion = body.motion === true && videogenConfigured();
  const withImages = !motion && body.withImages !== false;
  const startedAt = Date.now();

  // ── motion: every clip job starts together, then they are awaited
  // together. Done per-scene inside the loop below this would serialise
  // the slowest call in the product.
  const clips = motion
    ? await generateSceneClips(
        scenes.map((sc) => ({
          keyTerm: sc.keyTerm,
          heading: sc.heading,
          narration: String(sc.narration || ""),
          visualPrompt: sc.visualPrompt,
        })),
        { seconds: 4 }
      )
    : [];

  const clipIds: string[] = [];
  const imageIds: string[] = [];
  const durations: number[] = [];
  const rendered: RenderedScene[] = [];

  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const narration = String(scene.narration || "").trim();
    const out: RenderedScene = {
      index: i,
      imageUrl: null,
      clipUrl: null,
      imageModel: null,
      audioUrl: null,
      durationSec: Number(scene.durationSec) || null,
    };

    // ── the moving clip ─────────────────────────────────────────
    const clip = clips[i];
    if (clip) {
      out.imageModel = clip.model;
      const hosted = await uploadClip(clip.data, {
        publicId: `${sessionId}-clip-${i}`,
      });
      if (hosted) {
        out.clipUrl = hosted.url;
        clipIds.push(hosted.publicId);
      } else {
        out.clipUrl = `data:video/mp4;base64,${clip.data.toString("base64")}`;
      }
    } else if (motion) {
      out.error = "No clip generated for this scene";
    }

    // ── the still frame ─────────────────────────────────────────
    if (withImages) {
      const subject =
        scene.visualPrompt?.trim() ||
        `${scene.keyTerm || scene.heading || ""}. ${narration}`.slice(0, 400);

      const image = await generateSceneImage({
        subject,
        direction:
          i === 0
            ? "Opening frame — a wide establishing composition."
            : "Same palette and line weight as the previous frames.",
      });

      if (image) {
        out.imageModel = image.model;
        const hosted = await uploadImage(image.data, {
          publicId: `${sessionId}-scene-${i}`,
        });
        if (hosted) {
          out.imageUrl = hosted.url;
          imageIds.push(hosted.publicId);
        } else {
          // No Cloudinary — hand the bytes straight to the browser.
          out.imageUrl = `data:${image.mimeType};base64,${image.data.toString("base64")}`;
        }
      } else {
        out.error = "No image generated (provider unavailable or rate limited)";
      }
    }

    // ── the voice ───────────────────────────────────────────────
    const audio = await narrate(narration);
    if (audio) {
      const hosted = await uploadAudio(audio, {
        publicId: narrationId(sessionId, i, narration),
      });
      if (hosted) {
        out.audioUrl = hosted.url;
        out.durationSec = hosted.durationSec ?? out.durationSec;
      } else {
        out.audioUrl = `data:audio/mpeg;base64,${audio.toString("base64")}`;
      }
    }

    durations.push(out.durationSec || 4);
    rendered.push(out);
  }

  // ── the stitch ────────────────────────────────────────────────
  // Only possible when every frame made it to Cloudinary; a slideshow
  // referencing a public_id that was never uploaded fails as a whole.
  let mp4Url: string | null = null;
  // A swapped key/secret pair 401s in a way that reads like a bad account,
  // so name the real problem instead of letting it surface as "no video".
  let stitchNote: string | null = cloudinaryCredentialProblem();

  if (stitchNote) {
    // credential problem already reported; skip the doomed call
  } else if (motion && clipIds.length === scenes.length && clipIds.length) {
    // Splicing clips is a URL transformation, not a job — nothing to poll.
    mp4Url = spliceClipsUrl({ clipPublicIds: clipIds });
    if (!mp4Url) stitchNote = "Could not build the splice URL.";
  } else if (cloudinaryConfigured() && imageIds.length === scenes.length && imageIds.length) {
    const stitched = await stitchSlideshow({
      imagePublicIds: imageIds,
      slideDurations: durations,
      publicId: `${sessionId}-video`,
    });
    mp4Url = stitched?.url ?? null;
    if (!mp4Url) stitchNote = "Cloudinary accepted the frames but did not return a video.";
  } else if (!cloudinaryConfigured()) {
    stitchNote = "Cloudinary is not configured — playing the frames in the browser instead.";
  } else {
    stitchNote = "Not every frame reached Cloudinary, so the stitch was skipped.";
  }

  // Queryable in Elastic like everything else, so a rendered video is a
  // row in the same event log the metrics strip and memory read from.
  await recordEvent({
    sessionId,
    userId,
    type: "video_rendered",
    payload: {
      title: body.title ?? null,
      scenes: scenes.length,
      motion,
      clipsGenerated: rendered.filter((r) => r.clipUrl).length,
      framesGenerated: rendered.filter((r) => r.imageUrl).length,
      narrated: rendered.filter((r) => r.audioUrl).length,
      mp4Url,
      hosted: cloudinaryConfigured(),
      imageProviders: imagegenProviders(),
      ms: Date.now() - startedAt,
    },
  }).catch(() => undefined);

  return NextResponse.json({
    scenes: rendered,
    mp4Url,
    stitchNote,
    hosted: cloudinaryConfigured(),
    providers: imagegenProviders(),
    latencyMs: Date.now() - startedAt,
  });
}
