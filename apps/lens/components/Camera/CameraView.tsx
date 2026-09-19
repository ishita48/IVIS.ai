"use client";

/**
 * CameraView — the whole surface of the live tutor.
 *
 * The agent drives. There is no timer, no polling loop, and no dialogue tree
 * in this file. analyze_workspace runs when the agent decides it needs to
 * look; the Analyze button below is a demo fallback for when the agent is
 * connecting or the mic is unavailable, and is labelled as such.
 *
 * Must be rendered inside <ConversationProvider>.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PointerOverlay, type PointerBox } from "@/components/Camera/PointerOverlay";
import { useCamera } from "@/hooks/useCamera";
import { useAgent, type PaceMode, type AgentPhase } from "@/hooks/useAgent";

/** Matches LOW_CONFIDENCE in lib/vision.ts. */
const LOW_CONFIDENCE = 0.3;

type VisionResult = {
  observation: string;
  objects: string[];
  boundingBox: PointerBox;
  confidence: number;
  changedSincePrior: boolean;
};

type Look = {
  objective: string;
  result: VisionResult;
  latencyMs: number;
  at: number;
};

const PHASE_TEXT: Record<AgentPhase, string> = {
  idle: "not connected",
  connecting: "connecting",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  error: "error",
};

const PHASE_DOT: Record<AgentPhase, string> = {
  idle: "bg-zinc-500",
  connecting: "bg-amber-400 animate-pulse",
  listening: "bg-emerald-400",
  thinking: "bg-violet-400 animate-pulse",
  speaking: "bg-cyan-400 animate-pulse",
  error: "bg-red-400",
};

export function CameraView() {
  const { videoRef, stream, start: startCamera, stop: stopCamera, captureFrame, errorText: cameraError } =
    useCamera();

  const [looks, setLooks] = useState<Look[]>([]);
  const [box, setBox] = useState<PointerBox | null>(null);
  const [boxConfidence, setBoxConfidence] = useState(1);
  const [pace, setPace] = useState<PaceMode>("normal");
  const [predictions, setPredictions] = useState<{ text: string; at: number }[]>([]);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);

  // Read inside the tool handler, which the SDK holds across renders.
  const priorObservationRef = useRef<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  /**
   * One frame, one vision call. This is the agent's eye — it is also what the
   * manual fallback button calls, so there is exactly one code path.
   */
  const look = useCallback(
    async (objective: string): Promise<VisionResult & { latencyMs: number }> => {
      setVisionError(null);

      const frameDataUrl = captureFrame();
      const startedAt = performance.now();

      const res = await fetch("/api/vision/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frameDataUrl,
          objective,
          priorObservation: priorObservationRef.current,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        observation?: VisionResult;
        error?: string;
      };

      if (!res.ok || !payload.observation) {
        throw new Error(payload.error || "Vision analysis failed.");
      }

      const latencyMs = Math.round(performance.now() - startedAt);
      const result = payload.observation;

      // Side effect: the box goes on screen the moment the tool resolves,
      // before the agent has finished forming its sentence.
      setBox(result.boundingBox);
      setBoxConfidence(result.confidence);
      setLooks((prev) => [{ objective, result, latencyMs, at: Date.now() }, ...prev].slice(0, 8));
      priorObservationRef.current = result.observation;

      return { ...result, latencyMs };
    },
    [captureFrame]
  );

  const agent = useAgent({
    analyzeWorkspace: async (objective) => {
      try {
        const result = await look(objective);
        return {
          observation: result.observation,
          objects: result.objects,
          confidence: result.confidence,
          changed: result.changedSincePrior,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Vision analysis failed.";
        setVisionError(message);
        setBox(null);
        throw err;
      }
    },
    setPace: (mode) => setPace(mode),
    recordPrediction: (prediction) =>
      setPredictions((prev) => [{ text: prediction, at: Date.now() }, ...prev].slice(0, 12)),
  });

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [agent.transcript.length]);

  const handleManualAnalyze = async () => {
    setManualBusy(true);
    try {
      await look("Manual check requested by the student.");
    } catch (err) {
      setVisionError(err instanceof Error ? err.message : "Vision analysis failed.");
      setBox(null);
    } finally {
      setManualBusy(false);
    }
  };

  const latest = looks[0];
  const cameraLive = !!stream;
  const busy = !!agent.toolInFlight || manualBusy;
  const connected = agent.status === "connected";

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      {/* ── Video ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="relative overflow-hidden rounded-2xl border border-zinc-700 bg-black shadow-2xl">
          <div className="relative aspect-video w-full bg-zinc-950">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />

            <PointerOverlay
              box={box}
              videoEl={videoRef.current}
              objectFit="cover"
              active={busy}
              lowConfidence={boxConfidence < LOW_CONFIDENCE}
              label={boxConfidence < LOW_CONFIDENCE ? "hard to read" : "look here"}
            />

            {/* Camera-active indicator, live whenever the stream is. */}
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-xs text-zinc-100 backdrop-blur">
              <span
                className={`h-2 w-2 rounded-full ${cameraLive ? "bg-red-500 animate-pulse" : "bg-zinc-600"}`}
              />
              {cameraLive ? "camera active" : "camera off"}
            </div>

            {busy && (
              <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-cyan-500/90 px-3 py-1.5 text-xs font-semibold text-slate-950">
                looking…
              </div>
            )}
          </div>

          {/* ── Controls ──────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-700 bg-zinc-900/90 px-4 py-3 text-sm text-zinc-200">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${PHASE_DOT[agent.phase]}`} />
                <span className="font-medium">{PHASE_TEXT[agent.phase]}</span>
              </span>

              {agent.transport && (
                <span className="text-xs uppercase tracking-wide text-zinc-500">
                  {agent.transport}
                </span>
              )}

              {pace !== "normal" && (
                <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-200">
                  pace: {pace}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {connected && (
                <button
                  type="button"
                  onClick={() => agent.setMuted(!agent.isMuted)}
                  className="rounded-full border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-400"
                >
                  {agent.isMuted ? "unmute mic" : "mute mic"}
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleManualAnalyze()}
                disabled={busy}
                title="Fallback only — LENS normally decides when to look."
                className="rounded-full border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-400 disabled:opacity-40"
              >
                Analyze (fallback)
              </button>

              <button
                type="button"
                onClick={() => (connected ? agent.stop() : void agent.start())}
                disabled={agent.phase === "connecting"}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  connected
                    ? "border border-red-500/50 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                    : "bg-cyan-400 text-slate-950 hover:bg-cyan-300"
                }`}
              >
                {connected
                  ? "End Session"
                  : agent.phase === "connecting"
                    ? "Connecting…"
                    : "Start Session"}
              </button>
            </div>
          </div>
        </div>

        <p className="px-1 text-xs text-zinc-500">
          Frames are analyzed on demand, never recorded or stored. Only the derived text
          observation leaves your machine.
        </p>

        {(agent.error || cameraError || visionError) && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {[agent.error, cameraError, visionError].filter(Boolean).join(" · ")}
          </div>
        )}
      </section>

      {/* ── Transcript + telemetry ──────────────────────────────── */}
      <section className="flex min-h-0 flex-col gap-3">
        <div className="flex min-h-[18rem] flex-1 flex-col rounded-2xl border border-zinc-700 bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-2.5 text-xs uppercase tracking-wide text-zinc-400">
            <span>Transcript</span>
            {agent.interruptions > 0 && (
              <span className="text-zinc-500">{agent.interruptions} interruption{agent.interruptions === 1 ? "" : "s"}</span>
            )}
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3 text-sm">
            {agent.transcript.length === 0 ? (
              <p className="text-zinc-500">
                Start the session and say something. LENS greets you, then decides on its
                own when it needs to look.
              </p>
            ) : (
              agent.transcript.map((entry) => (
                <div
                  key={entry.id}
                  className={entry.role === "user" ? "text-zinc-300" : "text-cyan-200"}
                >
                  <span className="mr-2 text-[11px] uppercase tracking-wide text-zinc-500">
                    {entry.role === "user" ? "you" : "lens"}
                  </span>
                  {entry.text}
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {latest && (
          <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-200">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-zinc-400">
              <span>Last look</span>
              <span className="text-cyan-300">{latest.latencyMs} ms</span>
            </div>

            <p className="text-zinc-200">{latest.result.observation}</p>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span
                className={
                  latest.result.confidence < LOW_CONFIDENCE ? "text-amber-300" : "text-zinc-400"
                }
              >
                confidence {latest.result.confidence.toFixed(2)}
              </span>
              {latest.result.changedSincePrior && (
                <span className="text-emerald-300">changed since last look</span>
              )}
              {latest.result.objects.slice(0, 5).map((object) => (
                <span key={object} className="rounded-full bg-zinc-800 px-2 py-0.5">
                  {object}
                </span>
              ))}
            </div>

            {looks.length > 1 && (
              <p className="mt-3 text-xs text-zinc-500">
                {looks.length} looks this session · median{" "}
                {[...looks].map((l) => l.latencyMs).sort((a, b) => a - b)[
                  Math.floor(looks.length / 2)
                ]}{" "}
                ms
              </p>
            )}
          </div>
        )}

        {predictions.length > 0 && (
          <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4 text-sm">
            <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">
              Predictions
            </div>
            <ul className="space-y-1.5 text-zinc-300">
              {predictions.map((prediction) => (
                <li key={prediction.at} className="text-[13px]">
                  — {prediction.text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
