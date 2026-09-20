"use client";

/**
 * useDictation — push-to-talk think-aloud.
 *
 * Records one clip from the microphone and posts it to Deepgram through
 * our own route, so the API key never reaches the browser (see
 * app/api/deepgram/transcribe/route.ts for why streaming was not an
 * option on this account).
 *
 * The microphone is opened on press and closed on release, every time.
 * Holding a mic track open between dictations leaves the browser's
 * recording indicator lit while the student is not talking to anything,
 * which is the kind of small dishonesty a product about trust cannot
 * afford. It costs ~100ms per press and is worth it.
 *
 * On /live the ElevenLabs SDK owns the microphone. Do not mount this there
 * as well — two recorders on one device fight, and echo cancellation stops
 * working for both.
 */

import { useCallback, useRef, useState } from "react";

export type DictationState = "idle" | "recording" | "transcribing" | "error";

/** Containers worth trying, best first. Safari only has mp4. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

export function useDictation() {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const resolveRef = useRef<((text: string) => void) | null>(null);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const transcribe = useCallback(async (blob: Blob): Promise<string> => {
    setState("transcribing");
    try {
      const res = await fetch("/api/deepgram/transcribe", {
        method: "POST",
        headers: { "content-type": blob.type || "audio/webm" },
        body: blob,
      });
      const data = (await res.json().catch(() => ({}))) as {
        transcript?: string;
        empty?: boolean;
        latencyMs?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Transcription failed.");

      setLastMs(data.latencyMs ?? null);
      if (data.empty) {
        setError("Didn't catch that — try again a bit closer to the mic.");
        setState("idle");
        return "";
      }
      setState("idle");
      return String(data.transcript || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
      setState("error");
      return "";
    }
  }, []);

  /** Begin recording. Resolves the mic prompt before the UI says "listening". */
  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio.");
      setState("error");
      return false;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio.");
      setState("error");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || "audio/webm",
        });
        cleanup();
        // Anything under ~1KB is a mis-click, not speech.
        const text = blob.size > 1000 ? await transcribe(blob) : "";
        if (blob.size <= 1000) setState("idle");
        resolveRef.current?.(text);
        resolveRef.current = null;
      };

      recorder.start();
      recorderRef.current = recorder;
      setState("recording");
      return true;
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in the address bar and try again."
          : "Could not start the microphone."
      );
      setState("error");
      cleanup();
      return false;
    }
  }, [cleanup, transcribe]);

  /** Stop recording and resolve with the transcript (empty string if none). */
  const stop = useCallback((): Promise<string> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanup();
      setState("idle");
      return Promise.resolve("");
    }
    return new Promise<string>((resolve) => {
      resolveRef.current = resolve;
      recorder.stop();
    });
  }, [cleanup]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    resolveRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    cleanup();
    setState("idle");
  }, [cleanup]);

  return {
    state,
    error,
    lastMs,
    recording: state === "recording",
    busy: state === "transcribing",
    start,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}
