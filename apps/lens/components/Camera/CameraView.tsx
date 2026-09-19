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
import { useAgent, type PaceMode, type TeachMode, type UnderstandingNote, type Misconception, type AgentPhase } from "@/hooks/useAgent";
import { ReferencePanel, type ReferenceHandle } from "@/components/Camera/ReferencePanel";
import { SessionSummary } from "@/components/Camera/SessionSummary";
import { InspectorPanel, type InspectorEvent } from "@/components/Camera/InspectorPanel";

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
  idle: "bg-ink-600",
  connecting: "bg-ink-500 animate-pulse",
  listening: "bg-signal",
  thinking: "bg-signal-deep animate-pulse",
  speaking: "bg-signal animate-pulse",
  error: "bg-rose-500",
};

export function CameraView() {
  const { videoRef, stream, start: startCamera, stop: stopCamera, captureFrame, errorText: cameraError } =
    useCamera();

  const [looks, setLooks] = useState<Look[]>([]);
  const [box, setBox] = useState<PointerBox | null>(null);
  const [boxConfidence, setBoxConfidence] = useState(1);
  const [boxAt, setBoxAt] = useState<number | undefined>(undefined);
  const [pace, setPace] = useState<PaceMode>("normal");
  const [mode, setMode] = useState<TeachMode>("socratic");
  const [notes, setNotes] = useState<UnderstandingNote[]>([]);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [misconceptions, setMisconceptions] = useState<Misconception[]>([]);
  const [refBox, setRefBox] = useState<PointerBox | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const referenceRef = useRef<ReferenceHandle>({ captureFrame: () => null, hasVideo: false });
  const [predictions, setPredictions] = useState<{ text: string; at: number }[]>([]);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [events, setEvents] = useState<InspectorEvent[]>([]);

  const logRef = useRef(0);
  const log = useCallback(
    (kind: InspectorEvent["kind"], label: string, detail?: unknown) => {
      setEvents((prev) =>
        [...prev, { id: `e${++logRef.current}`, at: Date.now(), kind, label, detail }].slice(-200)
      );
    },
    []
  );

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
      log("vision", `capture → /api/vision/analyze  objective="${objective.slice(0, 60)}"`);

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
      setBoxAt(Date.now());
      setLooks((prev) => [{ objective, result, latencyMs, at: Date.now() }, ...prev].slice(0, 8));
      priorObservationRef.current = result.observation;

      // The raw record. A box on the wrong object is answered here: if these
      // coords point where the box drew, the model chose wrong; if they point
      // elsewhere, the overlay mapped wrong.
      log(
        "vision",
        `observed ${latencyMs}ms  conf=${result.confidence.toFixed(2)}  box=${result.boundingBox.x.toFixed(2)},${result.boundingBox.y.toFixed(2)} ${result.boundingBox.width.toFixed(2)}×${result.boundingBox.height.toFixed(2)}${result.changedSincePrior ? "  CHANGED" : ""}`,
        { objective, latencyMs, ...result }
      );

      return { ...result, latencyMs };
    },
    [captureFrame]
  );

  /**
   * One frame from the student, one from the reference, one comparison call.
   * The reference is not ground truth — see lib/vision.ts COMPARE_PROMPT.
   */
  const compare = useCallback(
    async (objective: string) => {
      if (!referenceRef.current.hasVideo) {
        throw new Error(
          "No reference video is loaded. Ask the student to add one before comparing."
        );
      }

      const liveDataUrl = captureFrame();
      const referenceDataUrl = referenceRef.current.captureFrame();
      if (!referenceDataUrl) {
        throw new Error("The reference video has no frame ready yet.");
      }

      const startedAt = performance.now();
      const res = await fetch("/api/vision/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveDataUrl, referenceDataUrl, objective }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        comparison?: {
          difference: string;
          liveBox: PointerBox;
          referenceBox: PointerBox;
          focus: string;
          confidence: number;
          aligned: boolean;
        };
        error?: string;
      };

      if (!res.ok || !payload.comparison) {
        throw new Error(payload.error || "Comparison failed.");
      }

      const c = payload.comparison;
      const latencyMs = Math.round(performance.now() - startedAt);

      // Box both sides: the student's frame and the same part on the reference.
      setBox(c.liveBox);
      setBoxConfidence(c.confidence);
      setBoxAt(Date.now());
      setRefBox(c.referenceBox);

      log(
        "vision",
        `compared ${latencyMs}ms  focus="${c.focus}"  conf=${c.confidence.toFixed(2)}${c.aligned ? "  ALIGNED" : ""}`,
        { objective, latencyMs, ...c }
      );

      return {
        difference: c.difference,
        focus: c.focus,
        confidence: c.confidence,
        aligned: c.aligned,
      };
    },
    [captureFrame, log]
  );

  const agent = useAgent({
    analyzeWorkspace: async (objective) => {
      log("tool", `agent called analyze_workspace("${objective.slice(0, 70)}")`, { objective });
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
        log("error", `analyze_workspace failed — ${message}`);
        setVisionError(message);
        setBox(null);
        throw err;
      }
    },
    setPace: (value) => {
      log("tool", `agent called set_pace("${value}")`, { mode: value });
      setPace(value);
    },
    setMode: (value) => {
      log("tool", `agent called set_mode("${value}")`, { mode: value });
      setMode(value);
    },
    compareToReference: async (objective) => {
      log("tool", `agent called compare_to_reference("${objective.slice(0, 70)}")`, { objective });
      try {
        return await compare(objective);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Comparison failed.";
        log("error", `compare_to_reference failed — ${message}`);
        setVisionError(message);
        throw err;
      }
    },
    noteMisconception: (note) => {
      log("tool", `agent called note_misconception("${note.belief.slice(0, 60)}")`, note);
      setMisconceptions((prev) => [...prev, { ...note, at: Date.now() }]);
    },
    noteUnderstanding: (note) => {
      log("tool", `agent called note_understanding("${note.topic}", ${note.level.toFixed(2)})`, note);
      setNotes((prev) => [...prev, { ...note, at: Date.now() }]);
    },
    recordPrediction: (prediction) => {
      log("tool", `agent called record_prediction("${prediction.slice(0, 70)}")`, { prediction });
      setPredictions((prev) => [{ text: prediction, at: Date.now() }, ...prev].slice(0, 12));
    },
  });

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [agent.transcript.length]);

  // React 18 double-invokes effects in dev, and transport resolves a beat
  // after phase does. Only log an actual transition.
  const lastPhaseRef = useRef<string>("");
  useEffect(() => {
    const line = `phase → ${agent.phase}${agent.transport ? ` (${agent.transport})` : ""}`;
    if (line === lastPhaseRef.current) return;
    lastPhaseRef.current = line;
    log("agent", line);
  }, [agent.phase, agent.transport, log]);

  useEffect(() => {
    if (agent.interruptions > 0) log("agent", `interrupted by student (#${agent.interruptions})`);
  }, [agent.interruptions, log]);

  useEffect(() => {
    if (agent.error) log("error", agent.error);
  }, [agent.error, log]);

  const handleManualAnalyze = async () => {
    setManualBusy(true);
    try {
      log("tool", "manual Analyze pressed (fallback path, not the agent)");
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
    <div className="mx-auto grid max-w-6xl items-start gap-4 px-4 pb-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      {/* ── Video ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="overflow-hidden rounded-3xl glass-panel p-2">
          {/* The frame stays dark. Video on white reads as a blown-out hole,
              and the box needs a surface it can actually sit on. */}
          <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-ink-100">
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
              capturedAt={boxAt}
              lowConfidence={boxConfidence < LOW_CONFIDENCE}
              label={boxConfidence < LOW_CONFIDENCE ? "hard to read" : "look here"}
            />

            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink-100/70 px-3 py-1.5 text-[11px] font-medium text-ink-900 backdrop-blur">
              <span className={`h-1.5 w-1.5 rounded-full ${cameraLive ? "bg-rose-500 pulse-dot" : "bg-ink-500"}`} />
              {cameraLive ? "camera active" : "camera off"}
            </div>

            {busy && (
              <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-signal px-3 py-1.5 text-[11px] font-semibold text-ink-950">
                looking…
              </div>
            )}
          </div>

          {/* ── Controls ──────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-3">
            <div className="flex items-center gap-3 text-[13px]">
              <span className="inline-flex items-center gap-2 text-ink-200">
                <span className={`h-2 w-2 rounded-full ${PHASE_DOT[agent.phase]}`} />
                <span className="font-medium">{PHASE_TEXT[agent.phase]}</span>
              </span>

              {agent.transport && (
                <span className="text-[11px] uppercase tracking-wide text-ink-500">
                  {agent.transport}
                </span>
              )}

              <button
                type="button"
                onClick={() => setRefOpen((v) => !v)}
                className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                  refOpen
                    ? "bg-signal text-ink-950 font-semibold"
                    : "glass-chip text-ink-400 hover:text-ink-100"
                }`}
              >
                reference
              </button>

              <div className="flex items-center gap-1 rounded-full glass-chip p-0.5">
                {(["socratic", "guided", "explain"] as TeachMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMode(m);
                      log("agent", `student set mode → ${m}`);
                      // Out-of-band: the agent should change how it teaches
                      // without treating this as something the student said.
                      agent.sendContext(
                        `The student switched you to ${m} mode. Follow the ${m} rules from now on. Acknowledge in about four words.`
                      );
                    }}
                    className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                      mode === m
                        ? "bg-signal text-ink-950 font-semibold"
                        : "text-ink-400 hover:text-ink-100"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {pace !== "normal" && (
                <span className="rounded-full glass-chip px-2.5 py-1 text-[11px] text-ink-300">
                  pace · {pace}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {connected && (
                <button
                  type="button"
                  onClick={() => agent.setMuted(!agent.isMuted)}
                  className="rounded-full glass-chip px-3 py-1.5 text-[12px] text-ink-300 transition hover:text-ink-100"
                >
                  {agent.isMuted ? "unmute" : "mute"}
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleManualAnalyze()}
                disabled={busy}
                title="Fallback only — LENS normally decides when to look."
                className="rounded-full glass-chip px-3 py-1.5 text-[12px] text-ink-400 transition hover:text-ink-100 disabled:opacity-40"
              >
                Analyze
              </button>

              <button
                type="button"
                onClick={() => {
                  if (connected) {
                    agent.stop();
                    setSummaryOpen(true);
                  } else {
                    setNotes([]);
                    setMisconceptions([]);
                    setSummaryOpen(false);
                    void agent.start();
                  }
                }}
                disabled={agent.phase === "connecting"}
                className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  connected
                    ? "glass-chip text-ink-300 hover:text-ink-100"
                    : "bg-signal text-ink-950 shadow-glow hover:bg-signal-deep"
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

        <p className="px-2 text-[12px] leading-relaxed text-ink-500">
          Frames are analyzed on demand, never recorded or stored. Only the derived text
          observation leaves your machine.
        </p>

        {(agent.error || cameraError || visionError) && (
          <div className="rounded-2xl border border-rose-300/60 bg-rose-50/70 px-4 py-3 text-[13px] text-rose-800 backdrop-blur">
            {[agent.error, cameraError, visionError].filter(Boolean).join(" · ")}
          </div>
        )}

        {refOpen && (
          <ReferencePanel
            box={refBox}
            onReady={(handle) => {
              referenceRef.current = handle;
            }}
            onLoaded={(fileName) => {
              log("agent", `student loaded reference video: ${fileName}`);
              agent.sendContext(
                `The student loaded a reference video ("${fileName}"). You can now call compare_to_reference to see their camera and that video side by side. Mention briefly that you can compare when they are ready.`
              );
            }}
          />
        )}

        {summaryOpen && (
          <SessionSummary
            notes={notes}
            misconceptions={misconceptions}
            looks={looks.length}
            predictions={predictions.length}
            onDismiss={() => setSummaryOpen(false)}
          />
        )}

        {latest && (
          <div className="rounded-3xl glass-panel p-4">
            <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-ink-500">
              <span>Last look</span>
              <span className="text-signal-deep">{latest.latencyMs} ms</span>
            </div>

            <p className="text-[14px] leading-relaxed text-ink-200">
              {latest.result.observation}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={
                  latest.result.confidence < LOW_CONFIDENCE
                    ? "font-medium text-amber-700"
                    : "text-ink-500"
                }
              >
                confidence {latest.result.confidence.toFixed(2)}
              </span>
              {latest.result.changedSincePrior && (
                <span className="font-medium text-signal-deep">changed since last look</span>
              )}
              {latest.result.objects.slice(0, 5).map((object) => (
                <span key={object} className="rounded-full glass-chip px-2 py-0.5 text-ink-400">
                  {object}
                </span>
              ))}
            </div>

            <p className="mt-2 font-mono text-[10px] text-ink-600">
              box {latest.result.boundingBox.x.toFixed(2)},{" "}
              {latest.result.boundingBox.y.toFixed(2)} ·{" "}
              {latest.result.boundingBox.width.toFixed(2)} ×{" "}
              {latest.result.boundingBox.height.toFixed(2)}
            </p>

            {looks.length > 1 && (
              <p className="mt-2 text-[11px] text-ink-500">
                {looks.length} looks · median{" "}
                {[...looks].map((l) => l.latencyMs).sort((a, b) => a - b)[
                  Math.floor(looks.length / 2)
                ]}{" "}
                ms
              </p>
            )}
          </div>
        )}

        {predictions.length > 0 && (
          <div className="rounded-3xl glass-panel p-4">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-500">
              Predictions
            </div>
            <ul className="space-y-1.5">
              {predictions.map((prediction) => (
                <li key={prediction.at} className="text-[13px] text-ink-300">
                  — {prediction.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        <InspectorPanel events={events} onClear={() => setEvents([])} />
      </section>

      {/* ── Transcript ──────────────────────────────────────────── */}
      <section className="flex min-h-0 flex-col lg:sticky lg:top-4">
        <div className="flex h-[26rem] flex-col overflow-hidden rounded-3xl glass-panel lg:h-[calc(100vh-7rem)]">
          <div className="flex items-center justify-between px-4 py-3 text-[11px] uppercase tracking-wide text-ink-500">
            <span>Transcript</span>
            {agent.interruptions > 0 && (
              <span>
                {agent.interruptions} interruption{agent.interruptions === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="mx-4 h-px glass-divider" />

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {agent.transcript.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-ink-500">
                Start the session and say something. LENS greets you, then decides on its
                own when it needs to look.
              </p>
            ) : (
              agent.transcript.map((entry) => (
                <div key={entry.id} className="text-[13px] leading-relaxed">
                  <span className="mr-2 text-[10px] uppercase tracking-wide text-ink-500">
                    {entry.role === "user" ? "you" : "lens"}
                  </span>
                  <span className={entry.role === "user" ? "text-ink-300" : "text-ink-100"}>
                    {entry.text}
                  </span>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      </section>
    </div>
  );
}
