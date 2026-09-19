"use client";

/**
 * useCamera — video only.
 *
 * Audio is deliberately NOT requested here. The ElevenLabs SDK opens and owns
 * the microphone; two getUserMedia audio tracks on the same page fight over
 * the device and echo cancellation stops working.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraError =
  | "not-supported"
  | "permission-denied"
  | "no-device"
  | "in-use"
  | "unknown";

export const CAMERA_ERROR_TEXT: Record<CameraError, string> = {
  "not-supported":
    "This browser cannot open a camera. Chrome or Safari over https (or localhost) is required.",
  "permission-denied":
    "Camera access was denied. Allow the camera for this site in your browser's address bar, then start the session again.",
  "no-device": "No camera was found. Connect one and start the session again.",
  "in-use": "The camera is already in use by another app. Close it and try again.",
  unknown: "The camera could not be started.",
};

/** Longest edge sent to the vision model. Keeps the upload small and fast. */
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.7;

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<CameraError | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setReady(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("not-supported");
      return false;
    }

    // Already running — don't open a second track.
    if (streamRef.current?.getVideoTracks().some((t) => t.readyState === "live")) {
      setReady(true);
      return true;
    }

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = media;
      setStream(media);

      if (videoRef.current) {
        videoRef.current.srcObject = media;
        videoRef.current.muted = true;
        await videoRef.current.play().catch(() => undefined);
      }

      setReady(true);
      return true;
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "permission-denied"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "no-device"
            : name === "NotReadableError" || name === "AbortError"
              ? "in-use"
              : "unknown"
      );
      return false;
    }
  }, []);

  /**
   * Draw the current frame to an offscreen canvas, downscale so the longest
   * edge is at most 1024px, and return a JPEG data URL.
   *
   * Returns null when the video has no frame yet (metadata not loaded), which
   * is the normal state for the first ~200ms after start().
   */
  const capture = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const { videoWidth, videoHeight } = video;
    const scale = Math.min(1, MAX_EDGE / Math.max(videoWidth, videoHeight));
    const width = Math.max(1, Math.round(videoWidth * scale));
    const height = Math.max(1, Math.round(videoHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  }, []);

  /** Same as capture(), but throws instead of returning null. */
  const captureFrame = useCallback((): string => {
    const frame = capture();
    if (!frame) {
      throw new Error("The camera has no frame yet. Give it a moment and try again.");
    }
    return frame;
  }, [capture]);

  useEffect(() => stop, [stop]);

  return {
    videoRef,
    stream,
    start,
    stop,
    capture,
    captureFrame,
    ready,
    error,
    errorText: error ? CAMERA_ERROR_TEXT[error] : null,
  };
}
