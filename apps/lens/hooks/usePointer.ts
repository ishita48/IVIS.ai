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
 * The share, held open across a session.
 *
 * It used to be one share per question: prompt, grab a frame, stop the
 * track. That reads as a share sheet that flashes up and vanishes after two
 * seconds, and in a voice conversation — where the agent decides when to
 * look — it meant a permission prompt on every single turn, which is not
 * usable. So the stream is kept until the student stops it or Chrome's own
 * "Stop sharing" bar ends it.
 *
 * Keeping it open is only acceptable because it is visible: Chrome shows
 * its own sharing indicator, and the UI shows a live chip with a stop
 * button. Nothing here is quiet.
 */
type ActiveShare = { stream: MediaStream; video: HTMLVideoElement };
let activeShare: ActiveShare | null = null;
const listeners = new Set<(sharing: boolean) => void>();

function announce() {
  for (const listener of listeners) listener(!!activeShare);
}

/** Subscribe to share start/stop. Returns an unsubscribe. */
export function onShareChange(listener: (sharing: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isSharing(): boolean {
  return !!activeShare?.stream.getVideoTracks().some((t) => t.readyState === "live");
}

export function stopScreenShare() {
  activeShare?.stream.getTracks().forEach((t) => t.stop());
  activeShare = null;
  announce();
}

/**
 * Grabs ONE frame for the pointer. Opens a share the first time and reuses
 * it afterwards, so the student authorises once per session rather than
 * once per question.
 */
export async function capturePointerFrame(): Promise<PointerFrame | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture isn't supported in this browser.");
  }

  const existing = isSharing() ? activeShare : null;
  if (existing) return drawFrame(existing.video);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 5, max: 15 } },
      audio: false,
      // Keep LENS out of its own capture. Without this the student can pick
      // the LENS tab, and the pointer ends up reading LENS's own overlay
      // back to itself instead of their work.
      selfBrowserSurface: "exclude",
      // Let them switch which window they are sharing without re-granting.
      surfaceSwitching: "include",
    } as DisplayMediaStreamOptions);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "AbortError") return null;
    throw new Error(
      error instanceof Error ? `Screen sharing failed: ${error.message}` : "Screen sharing failed."
    );
  }

  try {
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.muted = true;
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("The screen-share stream has no video track.");
    const ended = new Promise<never>((_, reject) => {
      track.addEventListener(
        "ended",
        () => reject(new Error("Screen sharing ended before a frame was captured.")),
        { once: true }
      );
    });

    await Promise.race([video.play(), ended]);

    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => {
        reject(new Error("Screen capture did not produce a frame. Select a tab or window and try again."));
      }, 8000);
      const onReady = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          window.clearTimeout(timer);
          resolve();
        }
      };
      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("loadeddata", onReady);
      video.addEventListener("canplay", onReady);
      track.addEventListener("ended", () => {
        window.clearTimeout(timer);
        reject(new Error("Screen sharing ended before a frame was captured."));
      }, { once: true });
      onReady();
    });

    // One frame's worth of settle time — capturing on the very first tick
    // sometimes yields a black frame in Chrome.
    await new Promise((r) => setTimeout(r, 180));

    // Hold it. Chrome's "Stop sharing" bar and the student's own stop
    // button both land here, so state never claims a share that has ended.
    track.addEventListener("ended", () => {
      if (activeShare?.stream === stream) {
        activeShare = null;
        announce();
      }
    }, { once: true });

    activeShare = { stream, video };
    announce();

    return drawFrame(video);
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    if (activeShare?.stream === stream) {
      activeShare = null;
      announce();
    }
    throw error;
  }
}

/** Draw the current frame at exactly the declared size. */
function drawFrame(video: HTMLVideoElement): PointerFrame {
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
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  if (!dataUrl.startsWith("data:image/") || dataUrl.length < 1000) {
    throw new Error("The shared screen produced an empty frame. Keep the share active and try again.");
  }

  return { dataUrl, declared, capture };
}
