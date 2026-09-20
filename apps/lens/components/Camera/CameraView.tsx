"use client";

/**
 * CameraView — the whole surface of the live tutor.
 *
 * The agent drives. There is no timer, no polling loop, and no dialogue tree
 * in this file. analyze_workspace runs when the agent decides it needs to
 * look; the Look button asks it to look now, for when the agent is
 * connecting or the mic is unavailable.
 *
 * Renders inside the /app workspace as the Camera mode. Must be rendered
 * inside <ConversationProvider>. Telemetry (Inspector, box coordinates,
 * latency, transport) is behind `?debug` — see useDebugPanels.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PointerOverlay, type PointerBox } from "@/components/Camera/PointerOverlay";
import { useCamera } from "@/hooks/useCamera";
import { useAgent, type PaceMode, type TeachMode, type UnderstandingNote, type Misconception, type AgentPhase } from "@/hooks/useAgent";
import { ReferencePanel, type ReferenceHandle } from "@/components/Camera/ReferencePanel";
import { useStallWatch } from "@/hooks/useStallWatch";
import { SessionSummary } from "@/components/Camera/SessionSummary";
import { SavedSessions } from "@/components/Camera/SavedSessions";
import { useLens } from "@/lib/store";
import { hasTopicContent } from "@/lib/topic-turn";
import { takeUnrecorded } from "@/lib/transcript-persist";
import { sameQuestion } from "@/lib/ladder";
import {
  startThinkAloud,
  stopThinkAloud,
  thinkAloudRunning,
  trackCall,
  utteranceToEventPayload,
  type InFlightKind,
  type Utterance,
} from "@/lib/deepgram";
import { InspectorPanel, type InspectorEvent } from "@/components/Camera/InspectorPanel";
import type { ReasoningState } from "@/lib/lens/contracts";
import { UnderstandingCheck } from "@/components/product/camera/UnderstandingCheck";
import { PredictionCard } from "@/components/product/camera/PredictionCard";
import { LadderStrip } from "@/components/Camera/LadderStrip";

/** Matches LOW_CONFIDENCE in lib/vision.ts. */
const LOW_CONFIDENCE = 0.3;

/** Reasoning runs at most this often from the live screen. */
const REASONING_MIN_GAP_MS = 15_000;
/** Shorter student turns ("yeah", "okay") carry no signal worth a model call. */

/**
 * A think-aloud stamp and the transcript turn it belongs to come from two
 * transcribers of the same speech: Deepgram stamps the utterance against the
 * call ledger (lib/deepgram.ts), ElevenLabs produces the turn the Transcript
 * renders. Neither knows the other exists, and the store drops the stamp on
 * the way to Mongo and back, so the two are matched here on time — a turn
 * whose timestamp lands within this much of the utterance's speech window is
 * the same speech. Wide enough to absorb the endpointing lag between the two
 * transcribers, narrow enough that the next sentence cannot claim the stamp.
 */
const STAMP_MATCH_MS = 6_000;

/** Stamps kept in memory. Comfortably more turns than the panel can show. */
const STAMP_LIMIT = 60;

/** The ledger's internal kinds, in the words the screen uses. */
const IN_FLIGHT_LABEL: Record<InFlightKind, string> = {
  vision: "vision call",
  analyze: "reasoning call",
};

/** One think-aloud utterance's stamp, kept only long enough to render it. */
type SpeechStamp = {
  kind: InFlightKind;
  /** Wall clock bounds of the speech, from Deepgram's own audio offsets. */
  startedAt: number;
  endedAt: number;
};

type VisionResult = {
  observation: string;
  objects: string[];
  boundingBox: PointerBox;
  confidence: number;
  changedSincePrior: boolean;
  /**
   * Pinned false by the Structured Outputs schema and checked a second time
   * server-side before the observation is returned (lib/vision.ts). Declared
   * required here so the raw disclosure prints whatever actually arrived: a
   * payload missing the key shows it missing rather than showing `false`.
   */
  shouldRevealAnswer: false;
  /** The vision model's own question. The engine's outranks it — see `look`. */
  suggestedQuestion?: string | null;
};

type Look = {
  objective: string;
  result: VisionResult;
  latencyMs: number;
  at: number;
};

/** What `look()` hands back: the frame, plus the rung the server allowed. */
type LookResult = VisionResult & {
  latencyMs: number;
  /** Null when the ladder call could not run — the frame result still stands. */
  reasoning: ReasoningState | null;
  /** Engine question first, vision model's second. Null when neither asked. */
  question: string | null;
};

/**
 * What the student is told the tutor is doing. "not connected" described a
 * websocket; nobody in front of this screen is waiting on a websocket. Idle
 * is the state you press Start Session from, so that is what it says — and
 * it says the same thing again after a session ends, because you can.
 */
const PHASE_TEXT: Record<AgentPhase, string> = {
  idle: "Ready to start",
  connecting: "Connecting\u2026",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Stopped",
};

const PHASE_DOT: Record<AgentPhase, string> = {
  idle: "bg-ink-600",
  connecting: "bg-ink-500 animate-pulse",
  listening: "bg-signal",
  thinking: "bg-signal-deep animate-pulse",
  speaking: "bg-signal animate-pulse",
  error: "bg-rose-500",
};

/**
 * Telemetry a student has no use for — the Inspector, box coordinates,
 * latency, transport — stays off the page unless asked for with `?debug`
 * in the URL or `localStorage.setItem("lens:debug", "1")`. It is all still
 * here for whoever is debugging the demo.
 */
function useDebugPanels(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).has("debug");
      const ls = window.localStorage.getItem("lens:debug") === "1";
      setOn(q || ls);
    } catch {
      // Private mode or no window: no debug panels.
    }
  }, []);
  return on;
}

/**
 * Deepgram failures are read by a person standing in front of a demo, so
 * they say what to change rather than what threw.
 *
 * The one that actually happens: the token route asks Deepgram for a
 * browser token and gets a 403. The key is fine for everything else — it
 * is the Member permission in the Deepgram console that grants minting,
 * and only that. Nothing here throws; think aloud is an optional surface
 * on top of a camera and a ladder that both work without it.
 */
function thinkAloudNotice(message: string): string {
  if (/\b403\b/.test(message)) {
    return "Think aloud is off — Deepgram refused to mint a browser token. The key needs Member permissions in the Deepgram console.";
  }
  if (/DEEPGRAM_API_KEY/.test(message)) {
    return "Think aloud is off — DEEPGRAM_API_KEY is not set on this server.";
  }
  if (/denied|NotAllowed|dismissed|Permission/i.test(message)) {
    return "Think aloud is off — the browser blocked microphone access.";
  }
  // Anything else, with the two things worth checking. The live one right
  // now is the route itself: /api/deepgram is not in the public matcher in
  // middleware.ts, so a caller without a Clerk session gets Clerk's 404 and
  // startThinkAloud never sees a token at all.
  return `Think aloud is off — ${message} Check that /api/deepgram is reachable and that the key has Member permissions.`;
}

/**
 * The validated Structured Outputs object, printed in the order lib/vision.ts
 * declares it.
 *
 * Rebuilt key by key rather than dumped whole, for two reasons: the box has
 * to be droppable (see below), and `suggestedQuestion` is ours — it is not in
 * the schema and printing it here would misrepresent what the model was held
 * to. Every value is read off the payload, `shouldRevealAnswer` included; the
 * point of showing this object is that the claim is checkable, which it stops
 * being the moment this function writes the answer in itself.
 *
 * `withBox` is the debug flag. Box coordinates are fractions of a frame — a
 * debugging aid, gated the same way the coordinate line above it is — and an
 * absent key reads more honestly than one holding a placeholder.
 */
function rawObservation(result: VisionResult, withBox: boolean): string {
  return JSON.stringify(
    {
      observation: result.observation,
      objects: result.objects,
      ...(withBox ? { boundingBox: result.boundingBox } : {}),
      confidence: result.confidence,
      changedSincePrior: result.changedSincePrior,
      shouldRevealAnswer: result.shouldRevealAnswer,
    },
    null,
    2
  );
}

/**
 * The controls a student touches once a lesson, if at all — the reference
 * video, saved sessions, think aloud. They used to sit in the same row, at
 * the same weight, as the button that begins a lesson, which left nothing
 * on the screen saying where to start. In here they are still one click
 * away and no longer compete with Start Session.
 *
 * `active` is how many of them are switched on, so a reference video or a
 * live transcript is not invisible once the menu closes.
 */
function MoreMenu({
  active,
  children,
}: {
  active: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 ${
          open || active > 0
            ? "border-signal/40 bg-signal/10 text-signal-deep"
            : "border-transparent glass-chip text-ink-400 hover:text-ink-100"
        }`}
      >
        More
        {active > 0 && <span className="font-semibold">{active}</span>}
        <svg
          aria-hidden
          viewBox="0 0 10 6"
          className={`h-1.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/* Upward, not downward: this row lives at the bottom of a card that
          clips its overflow, so a menu dropping below it would be cut in
          half. Rising over the video keeps it whole. */}
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-20 mb-2 flex w-60 flex-col gap-1 rounded-2xl glass-panel p-1.5"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** One row of the More menu: a label, and a dot when it is switched on. */
function MoreItem({
  on,
  label,
  hint,
  disabled,
  onClick,
}: {
  on?: boolean;
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={!!on}
      disabled={disabled}
      onClick={onClick}
      className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-signal/[0.08] disabled:opacity-40 focus-visible:outline-none focus-visible:bg-signal/[0.08]"
    >
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-signal" : "bg-ink-600"}`}
      />
      <span className="min-w-0">
        <span className={`block text-[12.5px] ${on ? "text-signal-deep" : "text-ink-200"}`}>
          {label}
        </span>
        <span className="block text-[11px] leading-snug text-ink-500">{hint}</span>
      </span>
    </button>
  );
}

export function CameraView() {
  const { videoRef, stream, start: startCamera, stop: stopCamera, captureFrame, waitForFrame, errorText: cameraError } =
    useCamera();
  const sessionId = useLens((state) => state.sessionId);
  const setView = useLens((state) => state.setView);
  const setAddSourceOpen = useLens((state) => state.setAddSourceOpen);

  // Idle-state focus reticle — purely a visual cue while the camera hasn't
  // started yet, no bearing on when `startCamera` actually runs.
  const [focusHover, setFocusHover] = useState(false);
  const [focusReady, setFocusReady] = useState(false);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (focusTimer.current) clearTimeout(focusTimer.current); }, []);
  function handleFocusEnter() {
    setFocusHover(true);
    setFocusReady(false);
    focusTimer.current = setTimeout(() => setFocusReady(true), 650);
  }
  function handleFocusLeave() {
    setFocusHover(false);
    setFocusReady(false);
    if (focusTimer.current) clearTimeout(focusTimer.current);
  }
  /**
   * The engine's check, if this turn produced one. Read straight off the
   * store — `runReasoning` writes it, `answerUnderstandingCheck` grades it
   * and re-derives the state, so there is nothing to mirror here.
   */
  const understandingCheck = useLens((state) => state.reasoning?.understandingCheck ?? null);

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
  const [watchStalls, setWatchStalls] = useState(true);
  /** The privacy sentence, folded behind the info icon until asked for. */
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const referenceRef = useRef<ReferenceHandle>({ captureFrame: () => null, hasVideo: false });
  const [predictions, setPredictions] = useState<{ text: string; at: number }[]>([]);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [events, setEvents] = useState<InspectorEvent[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  /** Bumped after a save so the sessions list refetches. */
  const [savedReloadKey, setSavedReloadKey] = useState(0);
  const [savingSession, setSavingSession] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const debug = useDebugPanels();

  /**
   * Think aloud. The socket lives in lib/deepgram.ts, not in React, so the
   * control asks `thinkAloudRunning()` what is true instead of keeping its
   * own boolean — a remount of this component then shows the real state.
   */
  const [thinkAloudOn, setThinkAloudOn] = useState(() => thinkAloudRunning());
  const [thinkAloudBusy, setThinkAloudBusy] = useState(false);
  const [thinkAloudNote, setThinkAloudNote] = useState<string | null>(null);
  /** Interim transcript, shown as a caption and replaced by the next one. */
  const [interimText, setInterimText] = useState("");
  /**
   * This run's think-aloud stamps, oldest first. They live here because the
   * store cannot carry them: refreshTranscript reads a voice_turn back as
   * {role, text, at} and the `inFlight` half of the payload never survives
   * the round trip. Bounded — a stamp older than the turns still on screen
   * can no longer match anything.
   */
  const [stamps, setStamps] = useState<SpeechStamp[]>([]);

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
  /**
   * Questions the ladder has already handed the agent this run. The engine
   * returns the same card until the ladder moves, and a card handed over
   * twice is the agent asking the same thing twice — the loop the demo
   * must never show. Cleared on Start Session.
   */
  const askedQuestionsRef = useRef<string[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  /** Mirror of `busy`, so the stall interval never fires mid-vision-call. */
  const busyRef = useRef(false);
  /** Ids of transcript entries already saved as voice_turn events. */
  const recordedTranscriptRef = useRef<Set<string>>(new Set());
  /** voice_turn writes still in flight — End Session waits for these. */
  const pendingTurnsRef = useRef<Set<Promise<unknown>>>(new Set());

  // Live-screen reasoning (feeds the tutor's hints): throttled, with one
  // trailing run. Runs after a prediction or a noted misconception only —
  // the voice-turn timer drives the concept map instead.
  const recentSpokenRef = useRef<string[]>([]);
  const lastReasoningAtRef = useRef(0);
  const reasoningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReasoning = useCallback(() => {
    if (reasoningTimerRef.current) return;
    const wait = Math.max(0, REASONING_MIN_GAP_MS - (Date.now() - lastReasoningAtRef.current));
    reasoningTimerRef.current = setTimeout(() => {
      reasoningTimerRef.current = null;
      lastReasoningAtRef.current = Date.now();
      void useLens.getState().analyzeReasoningNow({
        latestObservation: priorObservationRef.current,
        spokenText: recentSpokenRef.current.join(" "),
      });
    }, wait);
  }, []);
  useEffect(
    () => () => {
      if (reasoningTimerRef.current) clearTimeout(reasoningTimerRef.current);
    },
    []
  );

  const persistEvent = useCallback(
    async (type: string, payload: Record<string, unknown>) => {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, sessionId, payload }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { sessionId?: string };
      if (data.sessionId && data.sessionId !== useLens.getState().sessionId) {
        await useLens.getState()._loadSessionData(data.sessionId);
      }
      return data.sessionId || sessionId;
    },
    [sessionId]
  );

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  // Leaving the page ends the recording too. Without this the Deepgram
  // socket outlives the surface that opened it, and the student has no
  // control left to turn it off with.
  useEffect(() => {
    return () => {
      stopThinkAloud();
    };
  }, []);

  /**
   * The second half of a look: the five-rung ladder.
   *
   * The vision call describes a frame. It does not know what rung the student
   * has earned — that is computed from their whole event history, server-side,
   * by `nextAllowedLevel`/`capLevel` in lib/reasoning.ts, and the ONLY way to
   * reach that engine is POST /api/reasoning/analyze. Without this call the
   * Reasoning tab renders its empty state and "Deepest rung" reads "—", which
   * is the 2:25 beat of demo/script.md.
   *
   * Non-fatal by design. A frame the student can see with a box on it is
   * still the P0 loop; losing the rung should not lose the observation.
   */
  /** Motion since the last analyzed frame, mirrored from useStallWatch. */
  const sceneChangedRef = useRef(true);
  const markAnalyzedRef = useRef<() => void>(() => {});

  const runReasoning = useCallback(
    async (
      forSessionId: string | null,
      objective: string,
      latestObservation: string
    ): Promise<ReasoningState | null> => {
      if (!forSessionId) {
        log("agent", "no session id yet — skipping the ladder call");
        return null;
      }

      try {
        // Ledger. From here until the response settles this call is what
        // LENS is doing, so anything the student starts saying now stamps
        // against it — see lib/deepgram.ts.
        const res = await trackCall(
          "analyze",
          () =>
            fetch("/api/reasoning/analyze", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: forSessionId,
                objective: objective || undefined,
                latestObservation,
              }),
            }),
          { route: "/api/reasoning/analyze", objective: objective || null, sessionId: forSessionId }
        );

        const payload = (await res.json().catch(() => ({}))) as {
          state?: ReasoningState;
          error?: string;
        };

        if (!res.ok || !payload.state) {
          log(
            "error",
            `reasoning/analyze failed (HTTP ${res.status}) — ${payload.error || "no state returned"}`
          );
          return null;
        }

        // One copy, in the store. ReasoningGraph, the metrics strip and
        // UnderstandingCheck all read it from there; nothing is mirrored
        // into local state here.
        useLens.setState({ reasoning: payload.state });
        // The graph draws `timeline`, not `reasoning` — it is a list of every
        // persisted state, so it needs the GET. Events and metrics move for
        // the same reason the store moves them after its own analyze.
        void useLens.getState().refreshReasoning();
        void useLens.getState().refreshEvents();
        void useLens.getState().refreshMetrics();

        log(
          "agent",
          `ladder → rung "${payload.state.hintLevel}" · next ${payload.state.nextAction}` +
            (payload.state.insufficientEvidence ? "  (not enough evidence yet)" : ""),
          payload.state
        );

        return payload.state;
      } catch (err) {
        log(
          "error",
          `reasoning/analyze failed — ${err instanceof Error ? err.message : "unknown"}`
        );
        return null;
      }
    },
    [log]
  );

  /**
   * One frame, one vision call. This is the agent's eye — it is also what the
   * manual fallback button calls, so there is exactly one code path.
   */
  const look = useCallback(
    async (objective: string, opts?: { force?: boolean }): Promise<LookResult> => {
      setVisionError(null);

      await waitForFrame();
      const frameDataUrl = captureFrame();
      if (!frameDataUrl.startsWith("data:image/")) {
        throw new Error("Camera returned an invalid image frame. Restart the camera and try again.");
      }
      const startedAt = performance.now();
      log("vision", `capture → /api/vision/analyze  frame=${Math.round(frameDataUrl.length / 1024)}KB  objective="${objective.slice(0, 60)}"`);

      // Ledger, same as the ladder call below: the frame is in flight from
      // here until the response settles, and an utterance that starts in
      // that window is stamped with this call — see lib/deepgram.ts.
      const res = await trackCall(
        "vision",
        () =>
          fetch("/api/vision/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              // Without this the route calls resolveOrCreateSession with
              // null and mints a session per look. The ladder reads the
              // session's events, so every frame then arrives as the only
              // evidence in a session of its own and the rung never climbs
              // past OBSERVE. Read from the store, not the closure: the
              // first look sets it and later looks must see it.
              sessionId: useLens.getState().sessionId,
              frameDataUrl,
              objective: `${objective || "Identify what the student is working on"}. Teaching mode: ${mode}. Prioritize the exact wire, terminal, connector, component, or hand position relevant to this task.`,
              priorObservation: priorObservationRef.current,
              // The route's frame-skip check: the third gate of the cascade.
              // useStallWatch diffs frames on a timer; this is whether the
              // camera has moved since the last frame that actually went out.
              // Read through a ref because the stall watch is created after
              // this callback and its state must be current, not captured.
              sceneChanged: sceneChangedRef.current,
              // The student pressed the button. Whatever the skip heuristic
              // thinks, they asked to be looked at, so the call goes out.
              force: opts?.force === true,
            }),
          }),
        { route: "/api/vision/analyze", objective, frameBytes: frameDataUrl.length }
      );

      const payload = (await res.json().catch(() => ({}))) as {
        observation?: VisionResult;
        error?: string;
        sessionId?: string | null;
      };

      if (!res.ok || !payload.observation) {
        throw new Error(
          payload.error || `Vision analysis failed (HTTP ${res.status}). Check the server logs.`
        );
      }

      const latencyMs = Math.round(performance.now() - startedAt);
      const result = payload.observation;

      if (payload.sessionId) {
        useLens.setState({ sessionId: payload.sessionId });
        if (typeof window !== "undefined") {
          sessionStorage.setItem("lens:currentSessionId", payload.sessionId);
        }
      }

      // Side effect: the box goes on screen the moment the tool resolves,
      // before the agent has finished forming its sentence.
      setBox(result.boundingBox);
      setBoxConfidence(result.confidence);
      setBoxAt(Date.now());
      // A frame really went out, so motion since now is what counts.
      markAnalyzedRef.current();
      setLooks((prev) => [{ objective, result, latencyMs, at: Date.now() }, ...prev].slice(0, 8));
      priorObservationRef.current = result.observation;

      await persistEvent("camera_frame_analyzed", {
        observation: result.observation,
        objects: result.objects,
        confidence: result.confidence,
        changedSincePrior: result.changedSincePrior,
        latencyMs,
        objective,
      });

      // Now the ladder. The event above is this call's newest input, which is
      // why it runs second and why persistEvent is awaited.
      const reasoning = await runReasoning(
        payload.sessionId || useLens.getState().sessionId,
        objective,
        result.observation
      );

      // Engine question first. It has read every event in the session; the
      // vision model saw one frame. Same precedence the store applies in
      // lib/store.ts analyzeFrame.
      const question =
        reasoning?.understandingCheck?.question ||
        reasoning?.intervention ||
        result.suggestedQuestion ||
        null;

      // The raw record. A box on the wrong object is answered here: if these
      // coords point where the box drew, the model chose wrong; if they point
      // elsewhere, the overlay mapped wrong.
      log(
        "vision",
        `observed ${latencyMs}ms  conf=${result.confidence.toFixed(2)}  box=${result.boundingBox.x.toFixed(2)},${result.boundingBox.y.toFixed(2)} ${result.boundingBox.width.toFixed(2)}×${result.boundingBox.height.toFixed(2)}${result.changedSincePrior ? "  CHANGED" : ""}`,
        { objective, latencyMs, ...result }
      );

      return { ...result, latencyMs, reasoning, question };
    },
    [captureFrame, log, persistEvent, runReasoning, waitForFrame, mode]
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

        // The rung is not negotiable and it does not travel in the tool
        // result — AgentTools.analyzeWorkspace is a fixed shape owned by
        // hooks/useAgent.ts. It goes out of band instead, which is the same
        // channel mistake memory and mode switches use.
        if (result.reasoning) {
          const rung = result.reasoning.hintLevel;
          const question = result.question?.trim() || null;
          const alreadyAsked =
            !!question && askedQuestionsRef.current.some((q) => sameQuestion(q, question));
          if (question && !alreadyAsked) askedQuestionsRef.current.push(question);
          if (alreadyAsked) {
            log("agent", `ladder repeated a question already asked — told the agent not to re-ask`, { question });
          }
          agent.sendContext(
            `Server-side ruling, not something the student said: the deepest rung you are allowed on this turn is "${rung}". ` +
              `Do not go past it, and do not state the answer. ` +
              (question && !alreadyAsked
                ? `Say what you see in one short sentence, then ask this, close to word for word: "${question}" Then stop.`
                : alreadyAsked
                  ? `You have already asked "${question}" this session — do not ask it again in any wording. ` +
                    `Say what you see in one sentence and stop. If the student said they do not know or asked you to tell them, offer the next rung instead of a question.`
                  : `Say what you see in one short sentence and stop. Do not add a question unless the student needs one.`)
          );
        }

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
      scheduleReasoning();

      // Mistake memory. If this belief has surfaced before — in any mode,
      // any session — hand that back to the agent so it can say so out
      // loud. A student who hears "you reached for this same idea on a
      // circuit last Tuesday" learns something no per-session tutor can
      // tell them, and it is the whole point of storing beliefs rather
      // than transcripts.
      void (async () => {
        try {
          const res = await fetch("/api/mistakes", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionId: useLens.getState().sessionId,
              surface: "camera",
              belief: note.belief,
              rootCause: note.rootCause,
              evidence: note.practice,
            }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as {
            recurrence?: boolean;
            mistake?: { occurrences: number; firstSeenAt: string; surface: string };
          };
          if (!data.recurrence || !data.mistake) return;

          const since = new Date(data.mistake.firstSeenAt).toLocaleDateString(
            undefined,
            { weekday: "long" }
          );
          log(
            "agent",
            `mistake memory: recurrence #${data.mistake.occurrences} (first seen ${since})`,
            data.mistake
          );
          agent.sendContext(
            `Memory, not something the student said: this is the same belief they showed on ${since}, ` +
              `and it has now come up ${data.mistake.occurrences} times across different work. ` +
              `Say that you have seen them reach for this idea before and ask what makes it feel right — ` +
              `do not tell them the correct idea.`
          );
        } catch {
          /* memory is additive; never let it break a live session */
        }
      })();
      // Persisted as well as held in state: the understanding curve and the
      // beliefs are the session, and a session that only exists in React
      // state is gone on the next refresh.
      void persistEvent("misconception_noted", {
        belief: note.belief,
        rootCause: note.rootCause,
        practice: note.practice,
      });
    },
    noteUnderstanding: (note) => {
      log("tool", `agent called note_understanding("${note.topic}", ${note.level.toFixed(2)})`, note);
      setNotes((prev) => [...prev, { ...note, at: Date.now() }]);
      void persistEvent("understanding_noted", {
        topic: note.topic,
        level: note.level,
        why: note.why,
      });
    },
    recordPrediction: (prediction) => {
      log("tool", `agent called record_prediction("${prediction.slice(0, 70)}")`, { prediction });
      setPredictions((prev) => [{ text: prediction, at: Date.now() }, ...prev].slice(0, 12));
      // Analyze only once the prediction is on the event log.
      void persistEvent("prediction", { answer: prediction, source: "voice" }).then(
        scheduleReasoning
      );
    },
    searchNotes: async (query) => {
      log("tool", `agent called search_notes("${query.slice(0, 70)}")`, { query });
      const res = await fetch("/api/notes/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, sessionId: useLens.getState().sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        passages?: { title: string; text: string }[];
        error?: string;
      };
      if (!res.ok || !data.passages) {
        log("error", `search_notes failed — ${data.error || res.status}`);
        throw new Error(data.error || "Could not search the notes.");
      }
      log("tool", `search_notes → ${data.passages.length} passage(s)`, data.passages);
      return data.passages;
    },
  });

  useEffect(() => {
    // Every entry not yet saved, not just the newest: turns that land in one
    // render (the user's words and the agent's reply) would otherwise be lost.
    const fresh = takeUnrecorded(agent.transcript, recordedTranscriptRef.current);
    if (!fresh.length) return;
    let scheduleMap = false;
    for (const t of fresh) {
      const topical = hasTopicContent(t.text);
      if (t.role === "user" && topical) recentSpokenRef.current = [...recentSpokenRef.current, t.text].slice(-3);
      if (topical) scheduleMap = true;
      // The first thing the student says out loud names the session, the same
      // way the first typed message does.
      if (t.role === "user") void useLens.getState().nameSessionFrom(t.text);
    }
    // Saved one after another so event timestamps keep the spoken order.
    const pending = (async () => {
      for (const t of fresh) {
        try {
          await persistEvent("voice_turn", { role: t.role, text: t.text, at: t.at, source: "voice" });
        } catch {
          recordedTranscriptRef.current.delete(t.id); // try again on the next transcript change
        }
      }
      if (scheduleMap) useLens.getState().scheduleConceptMapUpdate();
    })();
    pendingTurnsRef.current.add(pending);
    void pending.finally(() => pendingTurnsRef.current.delete(pending));
  }, [agent.transcript, persistEvent]);

  // Saved turns (survive tab switches, End Session and reopening a session)
  // merged with this run's live turns; the same turn is never shown twice.
  const storedTranscript = useLens((state) => state.transcript);
  const shownTranscript = useMemo(() => {
    const seen = new Set<string>();
    return [...storedTranscript, ...agent.transcript]
      .filter((t) => {
        const key = `${t.role}|${t.at}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.at - b.at);
  }, [storedTranscript, agent.transcript]);

  /**
   * What LENS had in flight while this turn was being said, or null.
   *
   * Only a student turn can carry one: the stamp says what the student was
   * reacting to, and LENS talking over its own call is not evidence of
   * anything. When two stamps are in range the closer one wins, which is the
   * rule callInFlightAt already applies to overlapping calls.
   */
  const stampFor = useCallback(
    (entry: { role: string; at: number }): InFlightKind | null => {
      if (entry.role !== "user") return null;
      let best: SpeechStamp | null = null;
      let bestGap = Infinity;
      for (const stamp of stamps) {
        // Zero while the turn's timestamp falls inside the speech itself.
        const gap = Math.max(stamp.startedAt - entry.at, entry.at - stamp.endedAt, 0);
        if (gap <= STAMP_MATCH_MS && gap < bestGap) {
          best = stamp;
          bestGap = gap;
        }
      }
      return best?.kind ?? null;
    },
    [stamps]
  );

  // Coming back to this tab: the live buffer is gone, the saved turns are not.
  useEffect(() => {
    void useLens.getState().refreshTranscript();
  }, [sessionId]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [shownTranscript.length]);

  // Free signals — no extra calls, no polling. Just the last time each side spoke.
  const lastAgentAt = useMemo(
    () => [...agent.transcript].reverse().find((e) => e.role === "agent")?.at ?? 0,
    [agent.transcript]
  );
  const lastStudentAt = useMemo(
    () => [...agent.transcript].reverse().find((e) => e.role === "user")?.at ?? 0,
    [agent.transcript]
  );

  const stallWatch = useStallWatch({
    enabled: watchStalls,
    idle: agent.status === "connected" && agent.phase === "listening" && !busyRef.current,
    lastAgentAt,
    lastStudentAt,
    look: async (objective) => {
      const result = await look(objective);
      return { observation: result.observation, confidence: result.confidence };
    },
    sendContext: agent.sendContext,
    log,
  });
  sceneChangedRef.current = stallWatch.sceneChanged;
  markAnalyzedRef.current = stallWatch.markAnalyzed;

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

  /**
   * Keep this session. Writes one `session_saved` event carrying the title —
   * the contents were recorded as they happened, so there is nothing else to
   * write. Called on End Session, and again if the student renames it.
   *
   * Reads the session id out of the store rather than the closure: the id is
   * minted by the first event of the session, which may land after this
   * component rendered.
   */
  const saveSession = useCallback(
    async (title?: string): Promise<string | null> => {
      const id = useLens.getState().sessionId;
      if (!id) {
        // Nothing was recorded, so there is no session to keep. Not an error.
        log("agent", "nothing recorded yet — no session to save");
        return null;
      }

      setSavingSession(true);
      setSaveError(null);
      try {
        const res = await fetch("/api/sessions/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: id, title }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          title?: string;
          error?: string;
        };
        if (!res.ok || !payload.title) {
          throw new Error(payload.error || "Could not save the session.");
        }

        setSavedTitle(payload.title);
        setSavedReloadKey((key) => key + 1);
        log("agent", `session saved as "${payload.title}"`);
        return payload.title;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not save the session.";
        setSaveError(message);
        log("error", `save failed — ${message}`);
        return null;
      } finally {
        setSavingSession(false);
      }
    },
    [log]
  );

  const handleRename = async () => {
    const next = window.prompt("Name this session", savedTitle ?? "");
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    await saveSession(trimmed);
  };

  /**
   * No `stream` is passed. lib/deepgram.ts offers to reuse an existing mic
   * track, but hooks/useAgent.ts opens the mic only to raise the permission
   * prompt and stops every track immediately; the ElevenLabs SDK opens its
   * own and never hands it out. There is nothing to reuse, so Deepgram opens
   * a second recorder on the same device and we accept the double capture.
   */
  /**
   * Write the turn against the session that is live *now*.
   *
   * startThinkAloud reads opts.sessionId once and keeps it, and the store
   * has no id until the first analyze creates one — so a socket opened
   * before that posts null forever and /api/events mints a throwaway
   * session per utterance. The turns then sit in sessions of their own,
   * which is precisely the thing the stamp exists to prevent: the frame an
   * utterance refers to is in a different session from the utterance.
   *
   * Reading the store per utterance fixes that, and going through the same
   * fetch the rest of this file uses also carries the demo bearer, which
   * the module's own POST has no way to know about.
   */
  const persistThinkAloud = async (u: Utterance) => {
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "voice_turn",
          sessionId: useLens.getState().sessionId,
          payload: utteranceToEventPayload(u),
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { sessionId?: string };
      if (data.sessionId && !useLens.getState().sessionId) {
        await useLens.getState()._loadSessionData(data.sessionId);
      }
    } catch {
      // A dropped turn is not worth interrupting the lesson over.
    }
  };

  const toggleThinkAloud = async () => {
    if (thinkAloudRunning()) {
      stopThinkAloud();
      setThinkAloudOn(thinkAloudRunning());
      setInterimText("");
      log("agent", "think aloud off");
      return;
    }

    setThinkAloudBusy(true);
    setThinkAloudNote(null);
    try {
      await startThinkAloud({
        sessionId,
        // This file persists instead — see persistThinkAloud.
        persist: false,
        onInterim: (text) => setInterimText(text),
        onUtterance: (u) => {
          setInterimText("");
          void persistThinkAloud(u);
          // The same fact the log line below records, kept for the badge on
          // the transcript turn. An utterance said while LENS was idle has
          // nothing to stamp against and gets no badge.
          const inFlight = u.inFlight;
          if (inFlight) {
            setStamps((prev) =>
              [
                ...prev,
                { kind: inFlight.kind, startedAt: u.startedAt, endedAt: u.endedAt },
              ].slice(-STAMP_LIMIT)
            );
          }
          log(
            "agent",
            `think aloud → "${u.text}"  ${u.inFlight ? `during ${u.inFlight.kind}` : "no call in flight"}`,
            u
          );
        },
        onError: (message) => setThinkAloudNote(thinkAloudNotice(message)),
        onClose: () => {
          setThinkAloudOn(false);
          setInterimText("");
        },
      });
      log("agent", "think aloud on");
    } catch (err) {
      setThinkAloudNote(
        thinkAloudNotice(err instanceof Error ? err.message : "the socket would not open.")
      );
    } finally {
      setThinkAloudOn(thinkAloudRunning());
      setThinkAloudBusy(false);
    }
  };

  const handleManualAnalyze = async () => {
    setManualBusy(true);
    try {
      log("tool", "student asked LENS to look");
      // The curated ladder is keyed on the objective; a generic string
      // here would send every manual Look to the model path instead.
      await look(useLens.getState().objective || "Manual check requested by the student.", { force: true });
    } catch (err) {
      setVisionError(err instanceof Error ? err.message : "Vision analysis failed.");
      setBox(null);
    } finally {
      setManualBusy(false);
    }
  };

  /**
   * One way out, whether the student presses the button or says so.
   * Ending keeps everything: nothing is cleared or deleted, the last turns
   * are saved first, then one final map update, then the session is saved
   * so the understanding curve survives without a second press.
   */
  const endSession = () => {
    agent.stop();
    // The mic goes quiet when the lesson does. Think aloud is opt-in, but
    // nobody opts into it still listening after they have ended the session.
    stopThinkAloud();
    setThinkAloudOn(false);
    setInterimText("");
    setSummaryOpen(true);
    void Promise.allSettled([...pendingTurnsRef.current])
      .then(() => useLens.getState().finishSession())
      .then(() => saveSession());
  };
  const endSessionRef = useRef(endSession);
  endSessionRef.current = endSession;

  // "Stop session" said out loud ends it. The student should not have to
  // say it to LENS and then also find the button. Keyed on the turn's
  // timestamp so one utterance ends one session, never the next one too.
  const voiceEndedAtRef = useRef(0);
  useEffect(() => {
    if (agent.status !== "connected") return;
    const last = [...agent.transcript].reverse().find((e) => e.role === "user");
    if (!last || last.at <= voiceEndedAtRef.current) return;
    if (/\b(stop|end|finish)(\s+(the|this|my))?\s+session\b/i.test(last.text)) {
      voiceEndedAtRef.current = last.at;
      log("agent", `student said "${last.text.trim()}" — ending the session`);
      endSessionRef.current();
    }
  }, [agent.transcript, agent.status, log]);

  const latest = looks[0];
  const cameraLive = !!stream;
  const busy = !!agent.toolInFlight || manualBusy;
  busyRef.current = busy;
  const connected = agent.status === "connected";
  /** So the More button can say something is on without being opened. */
  const moreActive = [refOpen, savedOpen && debug, thinkAloudOn].filter(Boolean).length;

  // Lives beside the camera, not underneath it — a live conversation you
  // have to scroll past everything else to see is a conversation nobody
  // reads mid-session. Same content as before (including the "said during"
  // stamps), just a side panel instead of a full-width section at the end.
  const transcriptPanel = (
    <div className="flex min-h-[16rem] flex-col overflow-hidden border-t border-ink-800/10 lg:min-h-0 lg:border-l lg:border-t-0">
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
        {shownTranscript.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-ink-500">
            Start the session and say something. LENS greets you, then decides on its
            own when it needs to look.
          </p>
        ) : (
          shownTranscript.map((entry) => {
            // What LENS was doing while this was being said. Null for
            // every turn when think aloud is off, which is most of them.
            const during = stampFor(entry);
            return (
              <div key={entry.id} className="text-[13px] leading-relaxed">
                <span className="mr-2 text-[10px] uppercase tracking-wide text-ink-500">
                  {entry.role === "user" ? "you" : "lens"}
                </span>
                <span className={entry.role === "user" ? "text-ink-300" : "text-ink-100"}>
                  {entry.text}
                </span>
                {during && (
                  <span
                    title="Deepgram stamped this utterance against the model call LENS had in flight when it was said."
                    className="ml-2 inline-block whitespace-nowrap rounded-full glass-chip px-2 py-0.5 align-middle text-[10px] text-ink-400"
                  >
                    said during: {IN_FLIGHT_LABEL[during]}
                  </span>
                )}
              </div>
            );
          })
        )}
        <div ref={transcriptEndRef} />
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 scrollbar-slim">
      {/* ── Video + Transcript, one shared card ─────────────────── */}
      <div className="grid overflow-hidden rounded-3xl glass-panel lg:grid-cols-[2fr_1fr] lg:items-stretch">
        <div className="p-2">
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
              // Guided mode means more scaffolding on screen — that is what the
              // mode is for. Also whenever a frame came back unreadable, in any
              // mode, because "reposition the camera" needs something to aim at.
              guides={mode === "guided" || boxConfidence < LOW_CONFIDENCE}
              lowConfidence={boxConfidence < LOW_CONFIDENCE}
              label={boxConfidence < LOW_CONFIDENCE ? "hard to read" : "look here"}
            />

            {/* Viewfinder corner brackets — purely decorative framing. */}
            <div className="pointer-events-none absolute inset-4 hidden sm:block">
              <span className="absolute left-0 top-0 size-5 rounded-tl-lg border-l-2 border-t-2 border-signal/50" />
              <span className="absolute right-0 top-0 size-5 rounded-tr-lg border-r-2 border-t-2 border-signal/50" />
              <span className="absolute bottom-0 left-0 size-5 rounded-bl-lg border-b-2 border-l-2 border-signal/50" />
              <span className="absolute bottom-0 right-0 size-5 rounded-br-lg border-b-2 border-r-2 border-signal/50" />
            </div>

            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink-100/70 px-3 py-1.5 text-[11px] font-medium text-ink-900 backdrop-blur">
              <span className={`h-1.5 w-1.5 rounded-full ${cameraLive ? "bg-rose-500 pulse-dot" : "bg-ink-500"}`} />
              {cameraLive ? "camera active" : "camera off"}
            </div>

            {busy ? (
              <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-signal px-3 py-1.5 text-[11px] font-semibold text-white">
                looking…
              </div>
            ) : cameraLive ? (
              <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-emerald-50/90 px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-emerald-600 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 pulse-dot" />
                Ready
              </div>
            ) : null}

            {thinkAloudOn && interimText ? (
              <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-2xl bg-ink-100/80 px-3 py-2 text-[12px] leading-snug text-ink-900 backdrop-blur">
                <span className="mr-2 text-[10px] font-bold uppercase tracking-wide text-signal-deep">
                  thinking aloud
                </span>
                {interimText}
              </div>
            ) : null}

            {/* Iris empty state — covers the dark box until a real frame
                arrives, then gets out of the way. Doesn't gate startCamera,
                which already runs on mount; this is what's on screen while
                that permission prompt is pending, or after it's declined. */}
            <AnimatePresence>
              {!cameraLive && (
                <motion.div
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-ink-100 px-6 text-center"
                  onMouseEnter={handleFocusEnter}
                  onMouseLeave={handleFocusLeave}
                >
                  <div className="relative flex size-20 items-center justify-center">
                    <motion.svg
                      viewBox="0 0 100 100"
                      className="absolute inset-0 text-signal/20"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
                    >
                      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 7" />
                    </motion.svg>
                    <motion.div
                      className="absolute inset-3 rounded-full border border-signal/30"
                      animate={{ scale: [1, 1.05, 1], opacity: [0.45, 0.85, 0.45] }}
                      transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <svg viewBox="0 0 100 100" className="relative size-11 text-signal-deep">
                      <circle cx="50" cy="50" r="33" fill="none" stroke="currentColor" strokeWidth="2.5" />
                      <circle cx="50" cy="50" r="9" fill="currentColor" />
                    </svg>
                    <AnimatePresence>
                      {focusHover && (
                        <motion.div
                          initial={{ scale: 0.7, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.85, opacity: 0 }}
                          className="pointer-events-none absolute inset-0"
                        >
                          <span className="absolute left-0 top-0 size-3 border-l-2 border-t-2 border-signal" />
                          <span className="absolute right-0 top-0 size-3 border-r-2 border-t-2 border-signal" />
                          <span className="absolute bottom-0 left-0 size-3 border-b-2 border-l-2 border-signal" />
                          <span className="absolute bottom-0 right-0 size-3 border-b-2 border-r-2 border-signal" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="h-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-deep">
                    {focusHover ? (focusReady ? "Ready" : "Focusing…") : " "}
                  </div>

                  <div>
                    <p className="text-[15px] font-bold uppercase tracking-wide text-ink-100">
                      Point LENS at your work
                    </p>
                    <p className="mx-auto mt-2 max-w-xs text-[12px] leading-relaxed text-ink-500">
                      LENS observes one frame at a time and guides your next step.
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => void startCamera()}
                      className="rounded-md border border-signal/40 bg-signal px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-signal-deep"
                    >
                      Start camera
                    </button>
                    <button
                      onClick={() => {
                        setView("sources");
                        setAddSourceOpen(true);
                      }}
                      className="rounded-md border border-ink-800/15 bg-white/50 px-4 py-2 text-[12.5px] font-medium text-ink-200 transition hover:border-signal/30 hover:text-ink-100"
                    >
                      Upload
                    </button>
                  </div>

                  {cameraError && <p className="max-w-xs text-[11px] text-rose-500">{cameraError}</p>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Controls ──────────────────────────── */}
          {/* Left says what the tutor is doing and how it teaches; right is
              the three things you can press, in the order you need them.
              One filled button on this screen, and it is the one that
              starts the demo. */}
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-2 py-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className="inline-flex items-center gap-2 text-ink-200">
                  <span className={`h-2 w-2 rounded-full ${PHASE_DOT[agent.phase]}`} />
                  <span className="font-medium">{PHASE_TEXT[agent.phase]}</span>
                </span>

                {debug && agent.transport && (
                  <span className="text-[11px] uppercase tracking-wide text-ink-500">
                    {agent.transport}
                  </span>
                )}

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
                      className={`rounded-full px-2.5 py-1 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 ${
                        mode === m
                          ? "bg-signal text-ink-950 font-semibold"
                          : "text-ink-400 hover:text-ink-100"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                {debug && pace !== "normal" && (
                  <span className="rounded-full glass-chip px-2.5 py-1 text-[11px] text-ink-300">
                    pace · {pace}
                  </span>
                )}
              </div>

              {/* Three words nobody can guess the meaning of, so say it. */}
              <p className="text-[11px] leading-snug text-ink-500">
                socratic asks only, guided names the idea, explain teaches the concept
              </p>
            </div>

            <div className="flex items-center gap-2">
              <MoreMenu active={moreActive}>
                {(close) => (
                  <>
                    <MoreItem
                      on={refOpen}
                      label="Reference video"
                      hint="Load a clip LENS can compare your work against."
                      onClick={() => {
                        setRefOpen((v) => !v);
                        close();
                      }}
                    />

                    {debug && (
                      <MoreItem
                        on={savedOpen}
                        label="Saved sessions"
                        hint="Reopen a lesson you already finished."
                        onClick={() => {
                          setSavedOpen((v) => !v);
                          close();
                        }}
                      />
                    )}

                    {/* One row in place of the control when Deepgram will not
                        play. The camera and the ladder do not depend on it. */}
                    {thinkAloudNote ? (
                      <p className="px-2.5 py-2 text-[11px] leading-snug text-ink-500">
                        {thinkAloudNote}
                      </p>
                    ) : (
                      <MoreItem
                        on={thinkAloudOn}
                        disabled={thinkAloudBusy}
                        label="Think aloud"
                        hint="Transcribe what you say and stamp each sentence with the call LENS had in flight."
                        onClick={() => {
                          void toggleThinkAloud();
                          close();
                        }}
                      />
                    )}
                  </>
                )}
              </MoreMenu>

              {/* Stays in the open during a session: wanting the mic off is
                  never something you want to go hunting through a menu for. */}
              {connected && (
                <button
                  type="button"
                  onClick={() => agent.setMuted(!agent.isMuted)}
                  className="rounded-full glass-chip px-3 py-1.5 text-[12px] text-ink-300 transition hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
                >
                  {agent.isMuted ? "Unmute" : "Mute"}
                </button>
              )}

              <button
                type="button"
                onClick={() => void handleManualAnalyze()}
                disabled={busy}
                title="Ask LENS to look right now."
                className="rounded-full border border-signal/30 px-3.5 py-1.5 text-[12px] font-medium text-signal-deep transition hover:bg-signal/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
              >
                Look
              </button>

              <button
                type="button"
                onClick={() => {
                  if (connected) {
                    endSession();
                  } else {
                    setNotes([]);
                    setMisconceptions([]);
                    setSummaryOpen(false);
                    setSavedTitle(null);
                    setSaveError(null);
                    askedQuestionsRef.current = [];
                    // Last run's stamps would sit within the match window of
                    // this run's first turns and badge speech they never heard.
                    setStamps([]);
                    void agent.start();
                  }
                }}
                disabled={agent.phase === "connecting"}
                className={`rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 ${
                  connected
                    ? "glass-chip px-4 py-1.5 text-[12px] text-ink-300 hover:text-ink-100"
                    : "bg-signal px-5 py-2.5 text-[13.5px] text-ink-950 shadow-glow hover:bg-signal-deep"
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
        {transcriptPanel}
      </div>

      <section className="flex flex-col gap-3">
        {/* Two lines of fine print, one of them a setting, became one line
            you can read without stopping. The privacy sentence is still a
            click away and still says exactly what it said before. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 text-[11px] text-ink-500">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={watchStalls}
              onChange={(e) => setWatchStalls(e.target.checked)}
              className="size-3.5 accent-[#E06646]"
            />
            Check in if I go quiet
          </label>

          <button
            type="button"
            onClick={() => setPrivacyOpen((v) => !v)}
            aria-expanded={privacyOpen}
            className="inline-flex items-center gap-1.5 rounded-full transition hover:text-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50"
          >
            <span
              aria-hidden
              className="grid size-3.5 place-items-center rounded-full border border-current text-[8px] font-bold leading-none"
            >
              i
            </span>
            Nothing is recorded
          </button>
        </div>

        {privacyOpen && (
          <p className="max-w-md px-2 text-[11px] leading-relaxed text-ink-500">
            Frames are analyzed on demand, never recorded or stored. Only the derived text
            observation leaves your machine.
          </p>
        )}

        {(agent.error || cameraError || visionError || saveError) && (
          <div className="alert-error rounded-2xl px-4 py-3 text-[13px]">
            {[agent.error, cameraError, visionError, saveError]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}

        {/* #4 on the README protect list. It was imported only by the dead
            copy of this component, so it rendered nowhere. The engine
            supplies the question; grading and the follow-up event live in
            the component and the store. */}
        {/* Keyed on the question: the component holds the picked answer in
            local state, so the next check needs a fresh instance or it
            renders already-answered. */}
        {/* The judge's turn first, then the ladder their answer lights. Both
            need a session: the pick is an event and the cap is a query. */}
        {sessionId && <PredictionCard key={sessionId} />}
        {sessionId && <LadderStrip />}

        {understandingCheck && (
          <UnderstandingCheck key={understandingCheck.question} check={understandingCheck} />
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

        {savedOpen && (
          <SavedSessions
            activeSessionId={sessionId}
            reloadKey={savedReloadKey}
            onClose={() => setSavedOpen(false)}
          />
        )}

        {summaryOpen && (savedTitle || savingSession) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-signal/[0.06] px-4 py-2.5 text-[12px] ring-1 ring-signal/15">
            <span className="text-ink-300">
              {savingSession ? (
                "Saving this session…"
              ) : (
                <>
                  Saved as{" "}
                  <span className="font-medium text-ink-100">{savedTitle}</span>
                </>
              )}
            </span>
            {!savingSession && (
              <button
                type="button"
                onClick={() => void handleRename()}
                className="rounded-full glass-chip px-3 py-1 text-[11px] text-ink-400 transition hover:text-ink-100"
              >
                Rename
              </button>
            )}
          </div>
        )}

        {/* `summaryOpen` is only ever set by endSession, so it is the "a
            session ended this run" flag. SessionSummary asserts it too, so
            no future caller can put an empty curve on screen mid-lesson. */}
        <SessionSummary
          ended={summaryOpen}
          notes={notes}
          misconceptions={misconceptions}
          looks={looks.length}
          predictions={predictions.length}
          onDismiss={() => setSummaryOpen(false)}
        />

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

            {debug && (
            <p className="mt-2 font-mono text-[10px] text-ink-600">
              box {latest.result.boundingBox.x.toFixed(2)},{" "}
              {latest.result.boundingBox.y.toFixed(2)} ·{" "}
              {latest.result.boundingBox.width.toFixed(2)} ×{" "}
              {latest.result.boundingBox.height.toFixed(2)}
            </p>
            )}

            {looks.length > 1 && (
              <p className="mt-2 text-[11px] text-ink-500">
                {looks.length} looks · median{" "}
                {[...looks].map((l) => l.latencyMs).sort((a, b) => a - b)[
                  Math.floor(looks.length / 2)
                ]}{" "}
                ms
              </p>
            )}

            {/* The sentence above is prose the model wrote. This is the
                object it was actually held to — so "LENS never gives the
                answer" can be read off `shouldRevealAnswer` instead of taken
                on trust. Collapsed, because a student reading an observation
                is not owed JSON, and one click away for anyone who is. */}
            <details className="mt-3 rounded-2xl border border-ink-800/15 bg-white/50 p-3">
              <summary className="cursor-pointer text-[11px] font-medium text-ink-400">
                raw observation
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-ink-400">
                {rawObservation(latest.result, debug)}
              </pre>
              {!debug && (
                <p className="mt-2 text-[10px] text-ink-600">
                  boundingBox is left out here — add ?debug to the URL for the coordinates.
                </p>
              )}
            </details>
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
        {debug && <InspectorPanel events={events} onClear={() => setEvents([])} />}
      </section>
    </div>
  );
}
