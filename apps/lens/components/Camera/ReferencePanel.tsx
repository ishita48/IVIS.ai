"use client";

/**
 * ReferencePanel — the video the student is working from.
 *
 * The reference is whatever they bring: a dance clip, a grip, a stance, a lab
 * technique. LENS does not judge it and does not treat it as correct — it is
 * simply the other image in the comparison.
 *
 * Scrubbing is deliberately manual. Aligning two performances in time needs
 * pose tracking over a sequence; pausing on a pose needs nothing, and the
 * student knows which moment they care about better than any aligner would.
 *
 * The file never leaves the browser — it is read as an object URL and the
 * frame handed to the vision call is the only thing that goes anywhere.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PointerOverlay, type PointerBox } from "@/components/Camera/PointerOverlay";

const MAX_EDGE = 1024;

export type ReferenceHandle = {
  /** Current frame as a JPEG data URL, or null when nothing is loaded. */
  captureFrame: () => string | null;
  hasVideo: boolean;
};

export function ReferencePanel({
  box,
  onReady,
  onLoaded,
}: {
  box: PointerBox | null;
  onReady: (handle: ReferenceHandle) => void;
  onLoaded: (name: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      // Tainted canvas — a cross-origin video cannot be read back.
      return null;
    }
  }, []);

  useEffect(() => {
    onReady({ captureFrame, hasVideo: !!src });
  }, [captureFrame, src, onReady]);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("That is not a video file.");
      return;
    }
    setError(null);
    if (src) URL.revokeObjectURL(src);
    const url = URL.createObjectURL(file);
    setSrc(url);
    setName(file.name);
    onLoaded(file.name);
  };

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const step = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setPlaying(false);
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds));
  };

  return (
    <div className="overflow-hidden rounded-3xl glass-panel p-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-ink-100">
        {src ? (
          <>
            <video
              ref={videoRef}
              src={src}
              playsInline
              loop
              muted
              className="h-full w-full object-contain"
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
            <PointerOverlay
              box={box}
              videoEl={videoRef.current}
              objectFit="contain"
              label="reference"
            />
          </>
        ) : (
          <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 px-6 text-center">
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <span className="text-[13px] font-medium text-ink-800">
              Add a reference video
            </span>
            <span className="max-w-xs text-[11px] leading-relaxed text-ink-600">
              Whatever you are learning from — a dance, a grip, a stance. Pause it on the
              moment you care about, then ask LENS to compare.
            </span>
            <span className="mt-1 rounded-full bg-signal px-3 py-1.5 text-[11px] font-semibold text-ink-950">
              Choose file
            </span>
          </label>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-2 py-3">
        <span className="truncate text-[11px] text-ink-500">
          {name || "no reference loaded"}
        </span>

        {src && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => step(-0.1)}
              className="rounded-full glass-chip px-2.5 py-1 text-[11px] text-ink-400 hover:text-ink-100">
              ‹ 0.1s
            </button>
            <button type="button" onClick={toggle}
              className="rounded-full glass-chip px-3 py-1 text-[11px] font-medium text-ink-300 hover:text-ink-100">
              {playing ? "pause" : "play"}
            </button>
            <button type="button" onClick={() => step(0.1)}
              className="rounded-full glass-chip px-2.5 py-1 text-[11px] text-ink-400 hover:text-ink-100">
              0.1s ›
            </button>
          </div>
        )}
      </div>

      {error && <p className="px-2 pb-2 text-[11px] text-rose-500">{error}</p>}
    </div>
  );
}
