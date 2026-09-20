"use client";

/**
 * VideoSummary — the storyboard, played.
 *
 * What was here before was a script: headings, narration paragraphs and a
 * transcript, printed. That is a document *about* a video. This narrates
 * each scene with ElevenLabs and advances the slide when the audio for it
 * ends, so it runs on its own the way a lecture does.
 *
 * Advancing on the audio's `ended` event rather than on the model's
 * `durationSec` estimate matters more than it sounds: the estimate is a
 * guess at spoken length, and a slide that changes half a sentence early
 * is the single thing that makes a generated video feel broken. The real
 * clock is the audio, so the estimate is only ever used to draw a
 * progress bar before playback starts.
 *
 * Narration is fetched once for the whole deck and cached in state, so
 * scrubbing back to scene two does not re-synthesise it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Film,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from "lucide-react";
import { useLens } from "@/lib/store";

type Scene = {
  heading: string;
  narration: string;
  onScreen?: string[];
  keyTerm?: string;
  sourceTitle?: string;
  durationSec?: number;
  /** Older generations used this; still rendered if present. */
  visualPrompt?: string;
};

type Narrated = {
  index: number;
  audioUrl: string | null;
  /** Nano Banana's frame for this scene, when one was generated. */
  imageUrl?: string | null;
  /** A moving Sora clip, when motion mode was used. */
  clipUrl?: string | null;
  durationSec: number | null;
  error?: string;
};

export function VideoSummary({ result }: { result: any }) {
  const sessionId = useLens((s) => s.sessionId);
  const scenes: Scene[] = Array.isArray(result?.scenes) ? result.scenes : [];

  const [audio, setAudio] = useState<Narrated[] | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hosted, setHosted] = useState(false);
  const [mp4Url, setMp4Url] = useState<string | null>(null);
  const [withImages, setWithImages] = useState(true);
  const [motion, setMotion] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  /** Synthesise the whole deck once. */
  const prepare = useCallback(async (): Promise<Narrated[] | null> => {
    setPreparing(true);
    setError(null);
    try {
      // /render draws a frame per scene AND narrates; /narrate is the
      // voice-only path, which is far quicker when the student just wants
      // to hear it again.
      const res = await fetch(withImages || motion ? "/api/video/render" : "/api/video/narrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          withImages,
          motion,
          scenes: scenes.map((s) => ({
            narration: s.narration,
            heading: s.heading,
            keyTerm: s.keyTerm,
            visualPrompt: s.visualPrompt,
            durationSec: s.durationSec,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        scenes?: Narrated[];
        hosted?: boolean;
        mp4Url?: string | null;
        error?: string;
      };
      if (!res.ok || !data.scenes) {
        throw new Error(data.error || "Could not build this video.");
      }
      setAudio(data.scenes);
      setHosted(!!data.hosted);
      setMp4Url(data.mp4Url ?? null);
      return data.scenes;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Narration failed.");
      return null;
    } finally {
      setPreparing(false);
    }
  }, [scenes, sessionId, withImages, motion]);

  const playScene = useCallback((index: number, track: Narrated[]) => {
    const el = audioRef.current;
    const clip = track[index];
    if (!el) return;

    setCurrent(index);
    setProgress(0);

    // A scene whose narration failed still gets its slide — it just shows
    // silently and waits for the student rather than stopping the video.
    if (!clip?.audioUrl) {
      setPlaying(false);
      return;
    }
    el.src = clip.audioUrl;
    void el.play().catch(() => setPlaying(false));
    setPlaying(true);

    // Restart this scene's clip in step with its narration. The clip is
    // four seconds and the sentence is usually longer, so it loops —
    // cheaper than generating video nobody is looking at.
    const vid = videoRef.current;
    if (vid && clip.clipUrl) {
      vid.currentTime = 0;
      void vid.play().catch(() => undefined);
    }
  }, []);

  const start = useCallback(async () => {
    const track = audio ?? (await prepare());
    if (!track) return;
    playScene(0, track);
  }, [audio, prepare, playScene]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !audio) {
      void start();
      return;
    }
    if (playing) {
      el.pause();
      videoRef.current?.pause();
      setPlaying(false);
    } else {
      void el.play().catch(() => setPlaying(false));
      void videoRef.current?.play().catch(() => undefined);
      setPlaying(true);
    }
  }, [audio, playing, start]);

  // The audio is the clock: the slide changes when the sentence finishes,
  // not when a predicted duration elapses.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () =>
      setProgress(el.duration ? el.currentTime / el.duration : 0);
    const onEnd = () => {
      if (!audio) return;
      const next = current + 1;
      if (next < scenes.length) playScene(next, audio);
      else {
        setPlaying(false);
        setProgress(1);
      }
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
    };
  }, [audio, current, scenes.length, playScene]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  if (!scenes.length) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-ink-800/15 p-10 text-center text-[13px] text-ink-500">
        No scenes came back from that material.
      </div>
    );
  }

  const scene = scenes[current] ?? scenes[0];
  const estTotal = scenes.reduce((sum, s) => sum + (Number(s.durationSec) || 0), 0);
  const failedCount = (audio ?? []).filter((a) => a.error).length;

  return (
    <section className="mt-5 space-y-3">
      <audio ref={audioRef} className="hidden" />

      {/* ── The stage ───────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-ink-800/15 bg-ink-100 shadow-card">
        <div className="relative flex min-h-[19rem] flex-col justify-between p-7">
          {/* The generated frame. Text is composited over it by the markup
              below rather than drawn into the image, so it is always
              spelled correctly and stays selectable. */}
          {audio?.[current]?.clipUrl ? (
            <>
              <video
                ref={videoRef}
                src={audio[current].clipUrl!}
                className="absolute inset-0 h-full w-full object-cover"
                muted
                loop
                playsInline
                autoPlay
              />
              <div className="absolute inset-0 bg-gradient-to-r from-ink-100 via-ink-100/80 to-ink-100/20" />
            </>
          ) : (
            audio?.[current]?.imageUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={audio[current].imageUrl!}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-ink-100 via-ink-100/85 to-ink-100/30" />
              </>
            )
          )}
          <div className="relative flex min-h-[15rem] flex-col justify-between">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-signal">
                {scene.keyTerm || result.title || "Video summary"}
              </p>
              <h3 className="mt-2 max-w-xl text-[22px] font-semibold leading-snug text-ink-950">
                {scene.heading}
              </h3>
            </div>
            <span className="shrink-0 rounded-full bg-ink-950/10 px-2.5 py-1 font-mono text-[10px] text-ink-900/70">
              {current + 1}/{scenes.length}
            </span>
          </div>

          {/* What stays on screen while the narration plays. */}
          {(scene.onScreen?.length ?? 0) > 0 && (
            <ul className="my-5 space-y-2">
              {scene.onScreen!.slice(0, 4).map((line, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2.5 text-[15px] text-ink-900/80"
                  style={{
                    animation: `fadeUp 420ms ease-out ${i * 110}ms both`,
                  }}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-signal" />
                  {line}
                </li>
              ))}
            </ul>
          )}

          <div>
            {/* The spoken line, as a caption. */}
            <p className="max-w-2xl text-[13px] leading-relaxed text-ink-900/60">
              {scene.narration}
            </p>
            {scene.sourceTitle && (
              <p className="mt-2 text-[10px] uppercase tracking-wider text-ink-900/40">
                from {scene.sourceTitle}
              </p>
            )}
          </div>

          </div>

          {preparing && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ink-100/90 backdrop-blur-sm">
              <Loader2 className="size-5 animate-spin text-signal-deep" />
              <p className="text-[12px] text-ink-900/60">
                {motion
                  ? `Filming ${scenes.length} scenes — all clips render at once, about a minute…`
                  : withImages
                    ? `Drawing and narrating ${scenes.length} scenes…`
                    : `Narrating ${scenes.length} scenes…`}
              </p>
            </div>
          )}
        </div>

        {/* ── Scene progress ──────────────────────────────────── */}
        <div className="flex gap-1 px-3">
          {scenes.map((_, i) => (
            <button
              key={i}
              onClick={() => audio && playScene(i, audio)}
              disabled={!audio}
              aria-label={`Scene ${i + 1}`}
              className="group h-6 flex-1"
            >
              <span className="block h-1 w-full overflow-hidden rounded-full bg-ink-950/10">
                <span
                  className="block h-full rounded-full bg-signal transition-[width] duration-150"
                  style={{
                    width:
                      i < current ? "100%" : i === current ? `${progress * 100}%` : "0%",
                  }}
                />
              </span>
            </button>
          ))}
        </div>

        {/* ── Transport ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <button
              onClick={toggle}
              disabled={preparing}
              className="flex size-9 items-center justify-center rounded-full bg-signal text-ink-950 transition hover:bg-signal-deep hover:text-white disabled:opacity-50"
              aria-label={playing ? "Pause" : "Play"}
            >
              {preparing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="ml-0.5 size-4" />
              )}
            </button>
            {audio && (
              <button
                onClick={() => playScene(0, audio)}
                className="rounded-full p-1.5 text-ink-900/50 transition hover:text-ink-900"
                aria-label="Start over"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
            <span className="text-[11px] text-ink-900/50">
              {audio
                ? `${scenes.length} scenes`
                : `${scenes.length} scenes · ~${Math.round(estTotal)}s`}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-ink-900/40">
            {!audio && (
              <>
                <label className="flex cursor-pointer items-center gap-1.5 text-ink-900/60">
                  <input
                    type="checkbox"
                    checked={withImages && !motion}
                    disabled={motion}
                    onChange={(e) => setWithImages(e.target.checked)}
                    className="size-3 accent-[#00C2A8]"
                  />
                  stills
                </label>
                <label
                  className="flex cursor-pointer items-center gap-1.5 text-ink-900/60"
                  title="Generates a real 4s clip per scene. Slower and much more expensive than stills."
                >
                  <input
                    type="checkbox"
                    checked={motion}
                    onChange={(e) => setMotion(e.target.checked)}
                    className="size-3 accent-[#00C2A8]"
                  />
                  motion (~1 min, costly)
                </label>
              </>
            )}
            {mp4Url && (
              <a
                href={mp4Url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-signal-deep underline"
              >
                download mp4
              </a>
            )}
            {audio && (
              <span className="flex items-center gap-1.5">
                <Volume2 className="size-3" />
                {hosted ? "cached on Cloudinary" : "streamed per play"}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Film className="size-3" />
              generated from your material
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-300/40 bg-rose-50/60 p-3 text-[12px] text-rose-700">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {failedCount > 0 && (
        <p className="px-1 text-[11px] text-amber-600">
          {failedCount} scene{failedCount === 1 ? "" : "s"} could not be narrated —
          they play silently with their slide.
        </p>
      )}

      {/* The script stays available, below the thing that plays. */}
      {result.transcript && (
        <details className="rounded-2xl border border-ink-800/15 bg-white/50 p-4">
          <summary className="cursor-pointer text-[12px] font-medium text-ink-300">
            Transcript
          </summary>
          <pre className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-400">
            {result.transcript}
          </pre>
        </details>
      )}

      <style jsx>{`
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </section>
  );
}
