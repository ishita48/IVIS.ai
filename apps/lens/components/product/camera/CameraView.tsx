"use client";

/**
 * CameraView — Guided Camera Mode. THIS IS THE DEMO.
 * ─────────────────────────────────────────────────────────────────────
 * Owner: Person 1 (Frontend / Demo Lead).
 *
 * The loop, in the order a judge watches it happen:
 *   OBSERVE   tap Analyze → a real frame goes to a real vision call
 *   POINT     the bbox from that same response is drawn over the video
 *   ASK       a question appears; LENS waits instead of explaining
 *   VERIFY    student acts, taps Analyze again, LENS compares a NEW frame
 *
 * Two things that look like missing features and are not:
 *
 * 1. No auto-polling. Tap-to-analyze is more reliable on venue Wi-Fi and
 *    demos identically. Section 6.4 of the PDR cuts continuous streaming
 *    on purpose — do not add it back the night before.
 * 2. Upload Image is not a fallback UI. It posts to the SAME endpoint with
 *    the same code path, just a different input source. That is what makes
 *    it honest to use on stage when the Wi-Fi dies (and say so out loud).
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  CameraOff,
  ImageUp,
  Loader2,
  ScanSearch,
} from "lucide-react";
import { useCamera } from "@/hooks/useCamera";
import { useLens } from "@/lib/store";
import { cn } from "@/lib/cn";
import { CAMERA_STATE_LABEL } from "@/lib/lens/contracts";
import { BoxOverlay } from "./PointerOverlay";
import { UnderstandingCheck } from "./UnderstandingCheck";

export function CameraView() {
  const { videoRef, start, stop, capture, ready, error } = useCamera();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [starting, setStarting] = useState(false);

  const {
    cameraActive,
    setCameraActive,
    cameraState,
    observation,
    analyzing,
    lastLatencyMs,
    pendingQuestion,
    answerQuestion,
    analyzeFrame,
    objective,
    setObjective,
    reasoning,
  } = useLens();

  useEffect(() => {
    return () => stop();
  }, [stop]);

  async function toggleCamera() {
    if (cameraActive) {
      stop();
      setCameraActive(false);
      return;
    }
    setStarting(true);
    const ok = await start();
    setStarting(false);
    if (ok) setCameraActive(true);
  }

  async function onAnalyze() {
    const frame = capture();
    if (!frame) return;
    await analyzeFrame(frame, "camera");
  }

  async function onUpload(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Couldn't read that file"));
      r.readAsDataURL(file);
    });
    await analyzeFrame(dataUrl, "upload");
  }

  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      {/* ── Left: the video feed with the pointer layer ── */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="What are you working on? (e.g. getting this LED to light)"
            className="min-w-0 flex-1 rounded-xl border border-ink-800/15 bg-white/60 px-3 py-2 text-[13px] outline-none backdrop-blur focus:border-signal/50"
          />
          <StateChip state={cameraState} />
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-ink-800/15 bg-ink-100/95">
          <video
            ref={videoRef}
            playsInline
            muted
            className={cn(
              "h-full w-full object-contain transition-opacity",
              cameraActive && ready ? "opacity-100" : "opacity-0"
            )}
          />

          {/* Bounding box from the SAME response as the observation. */}
          {observation?.boundingBox && (
            <BoxOverlay
              box={observation.boundingBox}
              label={observation.possibleIssue ? "Look here" : "This one"}
              confidence={observation.confidence}
            />
          )}

          {!cameraActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <ScanSearch className="size-10 text-ink-600" />
              <p className="max-w-xs text-[13px] text-ink-500">
                Point a camera at what you&apos;re working on. LENS looks once
                when you ask it to — it doesn&apos;t watch you continuously.
              </p>
            </div>
          )}

          {error && (
            <div className="absolute inset-x-3 bottom-3 rounded-xl bg-rose-500/90 px-3 py-2 text-[12px] text-white">
              {error === "permission-denied"
                ? "Camera permission denied. Allow it in your browser, or use Upload Image."
                : error === "no-device"
                ? "No camera found. Use Upload Image instead."
                : "Couldn't start the camera. Use Upload Image instead."}
            </div>
          )}

          {analyzing && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink-100/40 backdrop-blur-[2px]">
              <div className="flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-[13px] font-medium">
                <Loader2 className="size-4 animate-spin text-signal-deep" />
                {CAMERA_STATE_LABEL[cameraState]}…
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleCamera}
            disabled={starting}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition",
              cameraActive
                ? "border-rose-400/40 text-rose-600 hover:bg-rose-500/10"
                : "border-ink-800/15 hover:border-signal/40 hover:bg-signal/5"
            )}
          >
            {cameraActive ? (
              <CameraOff className="size-4" />
            ) : (
              <Camera className="size-4" />
            )}
            {starting ? "Starting…" : cameraActive ? "Stop camera" : "Start camera"}
          </button>

          <button
            onClick={onAnalyze}
            disabled={!cameraActive || !ready || analyzing}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-signal px-4 py-2 text-[13px] font-semibold text-ink-950 transition hover:bg-signal-deep hover:text-white disabled:opacity-40"
          >
            {analyzing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ScanSearch className="size-4" />
            )}
            Analyze what you see
          </button>

          {/* Same endpoint, same code path — see the header note. */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={analyzing}
            title="Analyze a still image instead of the live camera"
            className="flex items-center gap-2 rounded-xl border border-ink-800/15 px-3 py-2 text-[13px] transition hover:border-signal/40 hover:bg-signal/5"
          >
            <ImageUp className="size-4" />
            Upload
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
        </div>

        {typeof lastLatencyMs === "number" && (
          <p className="text-[11px] text-ink-500">
            Last vision call: {lastLatencyMs}ms · camera is only active while
            you&apos;re on this tab, and frames are never stored
          </p>
        )}
      </div>

      {/* ── Right: what LENS saw, and what it's asking ── */}
      <aside className="flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto scrollbar-slim">
        <AnimatePresence mode="popLayout">
          {observation && (
            <motion.div
              key="obs"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-2xl border border-ink-800/15 bg-white/60 p-4 backdrop-blur"
            >
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-deep">
                What I can see
              </div>
              <p className="text-[13px] leading-relaxed text-ink-200">
                {observation.observation}
              </p>
              {observation.objects.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {observation.objects.map((o) => (
                    <span
                      key={o}
                      className="rounded-full bg-ink-900 px-2 py-0.5 text-[11px] text-ink-400"
                    >
                      {o}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {pendingQuestion && !pendingQuestion.answer && (
            <motion.div
              key="ask"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-2xl border border-signal/30 bg-signal/5 p-4"
            >
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-deep">
                Before I say anything
              </div>
              <p className="mb-3 text-[14px] font-medium text-ink-100">
                {pendingQuestion.question}
              </p>
              <div className="flex flex-col gap-1.5">
                {pendingQuestion.options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => answerQuestion(opt)}
                    className="rounded-xl border border-ink-800/15 bg-white/60 px-3 py-2 text-left text-[13px] transition hover:border-signal/50 hover:bg-white"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {reasoning?.understandingCheck && (
            <motion.div key="check" layout>
              <UnderstandingCheck check={reasoning.understandingCheck} />
            </motion.div>
          )}

          {reasoning?.intervention && !pendingQuestion && (
            <motion.div
              key="nudge"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-ink-800/15 bg-white/60 p-4 backdrop-blur"
            >
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-signal-deep">
                Try this — {reasoning.hintLevel.toLowerCase()}
              </div>
              <p className="text-[13px] leading-relaxed text-ink-200">
                {reasoning.intervention}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {!observation && (
          <div className="rounded-2xl border border-dashed border-ink-800/20 p-4 text-[12px] leading-relaxed text-ink-500">
            Nothing analyzed yet. Start the camera and tap{" "}
            <span className="font-medium text-ink-300">Analyze</span> — every
            word LENS says next comes from that frame, not from a script.
          </div>
        )}
      </aside>
    </div>
  );
}

function StateChip({ state }: { state: string }) {
  return (
    <span className="shrink-0 rounded-full border border-signal/30 bg-signal/10 px-2.5 py-1 text-[11px] font-medium text-signal-deep">
      {CAMERA_STATE_LABEL[state as keyof typeof CAMERA_STATE_LABEL] ?? state}
    </span>
  );
}
