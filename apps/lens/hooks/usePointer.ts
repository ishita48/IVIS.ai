"use client";

/**
 * Screen capture for LENS Pointer (screen mode).
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 3.
 *
 * The resize lives here rather than on the server for the reason the Swift
 * version documents at length: the declared Computer Use resolution and
 * the actual pixel dimensions of the image MUST agree. The browser already
 * holds the frame in a canvas, so drawing it at exactly the declared size
 * is free and removes any native image dependency from the route.
 *
 * Retina trap, carried over verbatim from ElementLocationDetector.swift:
 * do NOT multiply canvas.width by devicePixelRatio. If the JPEG is 2x the
 * declared size, every coordinate comes back at half scale and the bubble
 * lands in the wrong quadrant.
 */

import { SUPPORTED_RESOLUTIONS } from "@/lib/pointer";

export type PointerFrame = {
  dataUrl: string;
  declared: { width: number; height: number };
  capture: { width: number; height: number };
};

function bestResolution(w: number, h: number) {
  const aspect = w / Math.max(1, h);
  let best = SUPPORTED_RESOLUTIONS[1];
  let diff = Number.POSITIVE_INFINITY;
  for (const r of SUPPORTED_RESOLUTIONS) {
    const d = Math.abs(aspect - r.aspect);
    if (d < diff) {
      diff = d;
      best = r;
    }
  }
  return { width: best.width, height: best.height };
}

/**
 * Prompts for a screen/tab/window share, grabs ONE frame, stops the track
 * immediately. The share sheet is the user's consent; holding the stream
 * open after we have the frame is not something to do quietly.
 */
export async function capturePointerFrame(): Promise<PointerFrame | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture isn't supported in this browser.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: false,
    });
  } catch {
    return null; // user dismissed the picker
  }

  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    // One frame's worth of settle time — capturing on the very first tick
    // sometimes yields a black frame in Chrome.
    await new Promise((r) => setTimeout(r, 180));

    const capture = {
      width: video.videoWidth || 1440,
      height: video.videoHeight || 900,
    };
    const declared = bestResolution(capture.width, capture.height);

    const canvas = document.createElement("canvas");
    // Exact pixel dimensions. No devicePixelRatio. See the header note.
    canvas.width = declared.width;
    canvas.height = declared.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't get a 2D context for the capture");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, 0, 0, declared.width, declared.height);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      declared,
      capture,
    };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
