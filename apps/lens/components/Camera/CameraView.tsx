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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { PointerOverlay, type PointerBox } from "@/components/Camera/PointerOverlay";
import { useCamera } from "@/hooks/useCamera";
import { useAgent, type PaceMode, type TeachMode, type UnderstandingNote, type Misconception, type AgentPhase } from "@/hooks/useAgent";
import { ReferencePanel, type ReferenceHandle } from "@/components/Camera/ReferencePanel";
import { useStallWatch } from "@/hooks/useStallWatch";
import { SessionSummary } from "@/components/Camera/SessionSummary";
import { SavedSessions } from "@/components/Camera/SavedSessions";
import { useLens } from "@/lib/store";
import { trackCall } from "@/lib/deepgram";
import { InspectorPanel, type InspectorEvent } from "@/components/Camera/InspectorPanel";
import type { ReasoningState } from "@/lib/lens/contracts";
import { UnderstandingCheck } from "@/components/product/camera/UnderstandingCheck";

/** Matches LOW_CONFIDENCE in lib/vision.ts. */
const LOW_CONFIDENCE = 0.3;

/** Reasoning runs at most this often from the live screen. */
const REASONING_MIN_GAP_MS = 15_000;
/** Shorter student turns ("yeah", "okay") carry no signal worth a model call. */
const MIN_TURN_CHARS = 12;

type VisionResult = {
  observation: string;
  objects: string[];
  boundingBox: PointerBox;
  confidence: number;
  changedSincePrior: boolean;
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
  const { videoRef, stream, start: startCamera, stop: stopCamera, captureFrame, waitForFrame, errorText: cameraError } =
    useCamera();
  const sessionId = useLens((state) => state.sessionId);
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
  /**
   * One line explaining why Analyze cannot work, shown in place of the
   * button. Set only when /live is open to a signed-out visitor and the
   * server will not mint a demo token.
   */
  const [demoNotice, setDemoNotice] = useState<string | null>(null);

  /**
   * Demo access.
   *
   * /live is public in middleware.ts, but the routes it needs resolve a
   * caller through lib/demo-access.ts, and a visitor with no Clerk session
   * has none — so Analyze used to return 401 to a judge on their own phone.
   * POST /api/demo/token mints a 30-minute HMAC token when the server runs
   * with DEMO_MODE=1; it goes out as a bearer on the gated fetches below.
   *
   * Signed in, this whole block is inert: no mint, no header, byte-for-byte
   * the path that ran before.
   *
   * The token lives in a ref because the agent SDK holds the tool closures
   * across renders — a state read there would go stale.
   */
  const pathname = usePathname();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const demoTokenRef = useRef<string | null>(null);
  const mintedRef = useRef(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = demoTokenRef.current;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

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
  /** Mirror of `busy`, so the stall interval never fires mid-vision-call. */
  const busyRef = useRef(false);
  const recordedTranscriptRef = useRef<string | null>(null);
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
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ type, sessionId, payload }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { sessionId?: string };
      if (data.sessionId && data.sessionId !== useLens.getState().sessionId) {
        await useLens.getState()._loadSessionData(data.sessionId);
      }
      return data.sessionId || sessionId;
    },
    [authHeaders, sessionId]
  );

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  // Mint once, on /live, only when there is no Clerk session to fall back on.
  useEffect(() => {
    if (!authLoaded || isSignedIn || pathname !== "/live" || mintedRef.current) return;
    mintedRef.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/demo/token", { method: "POST" });
        const payload = (await res.json().catch(() => ({}))) as {
          token?: string;
          expiresAt?: string;
          analysesAllowed?: number;
          error?: string;
        };

        if (res.ok && payload.token) {
          demoTokenRef.current = payload.token;
          setDemoNotice(null);
          log(
            "agent",
            `demo access granted — ${payload.analysesAllowed ?? "?"} analyses, expires ${payload.expiresAt ?? "in 30 min"}`
          );
          return;
        }

        // A 404 is the ordinary answer on a normal deployment — the route
        // does not exist unless DEMO_MODE=1 — and it is also what Clerk's
        // middleware returns when /api/demo/token is not in its public
        // matcher. Either way it is a server configuration fact, not a
        // fault the visitor can act on, so the line stays short and the
        // status goes to the Inspector instead.
        setDemoNotice(
          res.status === 404
            ? "Demo access is off on this server — sign in to analyze."
            : payload.error ||
                `Demo access is unavailable (HTTP ${res.status}). Sign in to analyze.`
        );
        log("error", `demo token refused (HTTP ${res.status}) — ${payload.error || "no reason given"}`);
      } catch (err) {
        setDemoNotice(
          "Could not reach the demo token endpoint. Sign in to analyze, or check the server."
        );
        log("error", `demo token request failed — ${err instanceof Error ? err.message : "unknown"}`);
      }
    })();
  }, [authLoaded, isSignedIn, pathname, log]);

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
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              frameDataUrl,
              objective: `${objective || "Identify what the student is working on"}. Teaching mode: ${mode}. Prioritize the exact wire, terminal, connector, component, or hand position relevant to this task.`,
              priorObservation: priorObservationRef.current,
              // The route's frame-skip check. `undefined` means "no client
              // signal", and it falls back to its own prior-observation diff.
              //
              // TODO(session C2): hooks/useStallWatch.ts watches motion already
              // but does not expose it. When it returns a `sceneChanged` boolean,
              // read it off the stallWatch handle and pass it here.
              sceneChanged: undefined as boolean | undefined,
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
    [authHeaders, captureFrame, log, persistEvent, runReasoning, waitForFrame, mode]
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
        headers: { "Content-Type": "application/json", ...authHeaders() },
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
    [authHeaders, captureFrame, log]
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
          agent.sendContext(
            `Server-side ruling, not something the student said: the deepest rung you are allowed on this turn is "${rung}". ` +
              `Do not go past it, and do not state the answer.` +
              (result.question
                ? ` Ask this, close to word for word: "${result.question}"`
                : "")
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
    const latest = agent.transcript[agent.transcript.length - 1];
    if (!latest || recordedTranscriptRef.current === latest.id) return;
    recordedTranscriptRef.current = latest.id;
    const isStudentTurn = latest.role === "user" && latest.text.trim().length >= MIN_TURN_CHARS;
    if (isStudentTurn) recentSpokenRef.current = [...recentSpokenRef.current, latest.text].slice(-3);
    // The first thing the student says out loud names the session, the same
    // way the first typed message does.
    if (latest.role === "user") void useLens.getState().nameSessionFrom(latest.text);
    const pending = persistEvent("voice_turn", {
      role: latest.role,
      text: latest.text,
      at: latest.at,
    }).then(() => {
      if (isStudentTurn) useLens.getState().scheduleConceptMapUpdate();
    });
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

  const handleManualAnalyze = async () => {
    setManualBusy(true);
    try {
      log("tool", "manual Analyze pressed (fallback path, not the agent)");
      await look("Manual check requested by the student.", { force: true });
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
  busyRef.current = busy;
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

              <span className="text-[10px] uppercase tracking-wide text-ink-500">mode</span>
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
              <button
                type="button"
                onClick={() => setRefOpen((v) => !v)}
                aria-pressed={refOpen}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition ${
                  refOpen
                    ? "border-signal/40 bg-signal/10 text-signal-deep"
                    : "border-transparent glass-chip text-ink-400 hover:text-ink-100"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${refOpen ? "bg-signal" : "bg-ink-600"}`} />
                Reference
              </button>

              <button
                type="button"
                onClick={() => setSavedOpen((v) => !v)}
                aria-pressed={savedOpen}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition ${
                  savedOpen
                    ? "border-signal/40 bg-signal/10 text-signal-deep"
                    : "border-transparent glass-chip text-ink-400 hover:text-ink-100"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${savedOpen ? "bg-signal" : "bg-ink-600"}`}
                />
                Sessions
              </button>

              {connected && (
                <button
                  type="button"
                  onClick={() => agent.setMuted(!agent.isMuted)}
                  className="rounded-full glass-chip px-3 py-1.5 text-[12px] text-ink-300 transition hover:text-ink-100"
                >
                  {agent.isMuted ? "unmute" : "mute"}
                </button>
              )}

              {/* A button that can only return 401 is worse than no button.
                  When the server will not hand out a demo token, say why in
                  one line instead. */}
              {demoNotice ? (
                <p className="max-w-sm text-right text-[11px] leading-snug text-ink-500">
                  {demoNotice}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleManualAnalyze()}
                  disabled={busy}
                  title="Fallback only — LENS normally decides when to look."
                  className="rounded-full glass-chip px-3 py-1.5 text-[12px] text-ink-400 transition hover:text-ink-100 disabled:opacity-40"
                >
                  Analyze
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (connected) {
                    agent.stop();
                    setSummaryOpen(true);
                    // Last turns are saved first, then one final map update.
                    // Ending a session keeps it: nothing is cleared or deleted,
                    // and the session is saved so the understanding curve
                    // survives without a second button press.
                    void Promise.allSettled([...pendingTurnsRef.current])
                      .then(() => useLens.getState().finishSession())
                      .then(() => saveSession());
                  } else {
                    setNotes([]);
                    setMisconceptions([]);
                    setSummaryOpen(false);
                    setSavedTitle(null);
                    setSaveError(null);
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

        <div className="flex flex-wrap items-start justify-between gap-3 px-2">
          <p className="max-w-md text-[12px] leading-relaxed text-ink-500">
            Frames are analyzed on demand, never recorded or stored. Only the derived text
            observation leaves your machine.
          </p>

          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[11px] text-ink-500">
            <input
              type="checkbox"
              checked={watchStalls}
              onChange={(e) => setWatchStalls(e.target.checked)}
              className="size-3.5 accent-[#E06646]"
            />
            check in if I go quiet
          </label>
        </div>

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
            {shownTranscript.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-ink-500">
                Start the session and say something. LENS greets you, then decides on its
                own when it needs to look.
              </p>
            ) : (
              shownTranscript.map((entry) => (
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
