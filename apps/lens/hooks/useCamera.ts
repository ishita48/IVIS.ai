"use client";

/**
 * useCamera — getUserMedia + frame capture for Guided Camera Mode.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 1 (Frontend).
 *
 * Deliberately tap-to-analyze, not a polling loop. Continuous streaming
 * into a vision model is expensive, laggy, and the first thing to fall
 * over on venue Wi-Fi — and a judge cannot tell the difference between
 * "LENS analyzed a frame because you tapped" and "LENS analyzed a frame
 * three seconds ago", except that one of them reliably works.
 *
 * The frame is drawn to an offscreen canvas at capped width and exported
 * as JPEG: a 4K webcam frame is ~8MB of base64, which is slower to upload
 * than it is to analyze.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.82;

export type CameraError =
  | "not-supported"
  | "permission-denied"
  | "no-device"
  | "unknown";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("not-supported");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment", // rear camera on a phone; ignored on laptops
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
      return true;
    } catch (e: any) {
      const name = String(e?.name || "");
      setError(
        name === "NotAllowedError"
          ? "permission-denied"
          : name === "NotFoundError"
          ? "no-device"
          : "unknown"
      );
      return false;
    }
  }, []);

  /** Returns a base64 data URL of the current frame, or null. */
  const capture = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;

    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  }, []);

  // Release the camera on unmount — a live indicator light after the user
  // navigated away is a trust problem, not a bug report.
  useEffect(() => stop, [stop]);

  return { videoRef, start, stop, capture, ready, error };
}
