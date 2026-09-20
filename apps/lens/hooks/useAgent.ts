"use client";

/**
 * useAgent — the ElevenLabs conversation, and the client tools it can reach
 * back into the browser with.
 *
 * The agent owns the dialogue. Nothing in this file decides what LENS says,
 * when it looks, or which hint rung it is on. This file only:
 *   - mints a credential server-side and opens the connection
 *   - hands the agent its client tools
 *   - records what was said so the UI can show a transcript
 *
 * Transport: WebRTC when we can get a conversation token, WebSocket signed
 * URL as the fallback. startSession() resolves before the transport has
 * actually come up, so a failed WebRTC attempt surfaces through onError or an
 * early onDisconnect — that is where the fallback is triggered, exactly once
 * per start().
 *
 * NOTE: useConversation() must be rendered inside <ConversationProvider>.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { useLens } from "@/lib/store";
import type { GuideStatus } from "@/lib/lens/contracts";

export type AgentPhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type TranscriptEntry = {
  id: string;
  role: "user" | "agent";
  text: string;
  at: number;
};

export type PaceMode = "slower" | "normal" | "repeat";
export type TeachMode = "socratic" | "guided" | "explain";

/** A belief that keeps producing the same gap, and what addresses it. */
export type Misconception = {
  belief: string;
  rootCause: string;
  practice: string;
  at: number;
};

/** The agent's own read of how well the student grasps something. */
export type UnderstandingNote = {
  topic: string;
  /** 0-1. */
  level: number;
  why: string;
  at: number;
};

/**
 * One step of the on-screen guide, flattened to the four fields the agent
 * speaks from. The full row (`observation`, `target`, `index`, `pageUrl`,
 * `at`) stays on the server — the agent is a voice, and reading pixel
 * coordinates aloud helps nobody.
 */
export type GuideStepRead = {
  goal: string;
  step: string;
  why: string | null;
  status: GuideStatus;
};

/**
 * What `read_guide_step` hands back. Either a step, or a reason there is
 * none — never silence, because the agent has to say something either way.
 */
export type GuideStepResult =
  | ({ guiding: true } & GuideStepRead)
  | { guiding: false; reason: string };

/** What the browser can do on the agent's behalf. */
export type AgentTools = {
  /** Capture one frame now and describe it. Returns a compact result object. */
  analyzeWorkspace: (objective: string) => Promise<{
    observation: string;
    objects: string[];
    confidence: number;
    changed: boolean;
  }>;
  setPace: (mode: PaceMode) => void;
  setMode: (mode: TeachMode) => void;
  /** Compare the live camera to the loaded reference video. */
  compareToReference: (objective: string) => Promise<{
    difference: string;
    focus: string;
    confidence: number;
    aligned: boolean;
  }>;
  noteMisconception: (note: Omit<Misconception, "at">) => void;
  recordPrediction: (prediction: string) => void;
  noteUnderstanding: (note: Omit<UnderstandingNote, "at">) => void;
  /**
   * The session id the LENS Guide extension is writing its steps into, when
   * the page has been handed it. Optional: `read_guide_step` falls back to
   * the page's own session id, which is the same one whenever the extension
   * was told about it (SET_ACTIVE_SESSION) before the walkthrough started.
   */
  guideSessionId?: () => string | null;
};

type Credential = {
  conversationToken: string | null;
  signedUrl: string | null;
  warnings: string[];
};

let entryId = 0;
const nextId = () => `t${++entryId}`;

const asPace = (value: unknown): PaceMode =>
  value === "slower" || value === "repeat" ? value : "normal";

const asMode = (value: unknown): TeachMode =>
  value === "guided" || value === "explain" ? value : "socratic";

const GUIDE_STATUSES: GuideStatus[] = ["on_track", "off_track", "blocked", "done"];

/** How long to wait for the extension to name the guide's session. */
const GUIDE_SESSION_TIMEOUT_MS = 500;
let guideSessionReq = 0;

/**
 * Ask the LENS extension which session the guide is writing its steps into.
 *
 * The walkthrough runs in the extension, and /api/guide/step gives it a
 * session of its own — so the page's session id is the wrong key to read
 * the guide's events with. The existing content-script bridge answers with
 * the right one. Resolves null when the extension is absent or silent,
 * which is the normal case on a machine with no walkthrough running.
 */
function askExtensionForGuideSession(): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const requestId = `guide-session-${++guideSessionReq}`;

  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(value);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "lens-extension") return;
      if (data.type !== "GUIDE_SESSION" || data.requestId !== requestId) return;
      finish(typeof data.sessionId === "string" ? data.sessionId : null);
    };

    const timer = window.setTimeout(() => finish(null), GUIDE_SESSION_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "lens-app", type: "GUIDE_SESSION_REQUEST", requestId },
      window.location.origin
    );
  });
}

/**
 * Ask the server what step the on-screen guide is on.
 *
 * The guide runs in the Chrome extension, not on this page: it POSTs each
 * turn to /api/guide/step, which records a `guide_step` event. This reads
 * those back through /api/guide/state (PR #14) so the voice agent can
 * answer "what do I do next?" from the state the extension is acting on,
 * rather than guessing at a screen it cannot see.
 *
 * Every failure comes back as `guiding: false` with a sentence the agent
 * can say out loud. A tool that resolves to nothing leaves it improvising.
 */
async function readGuideStep(
  sessionId: string | null,
  limit: number
): Promise<GuideStepResult> {
  if (!sessionId) {
    return {
      guiding: false,
      reason:
        "There is no session yet, so there is no guide to read. Ask the student to start the walkthrough in the LENS extension.",
    };
  }

  let res: Response;
  try {
    res = await fetch(
      `/api/guide/state?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`,
      { cache: "no-store", credentials: "same-origin" }
    );
  } catch {
    return {
      guiding: false,
      reason: "The guide could not be reached just now. Say so plainly and carry on from the camera.",
    };
  }

  const body = (await res.json().catch(() => ({}))) as {
    latest?: {
      goal?: unknown;
      step?: unknown;
      why?: unknown;
      status?: unknown;
    } | null;
    error?: string;
  };

  if (!res.ok) {
    return {
      guiding: false,
      reason:
        res.status === 401
          ? "The student is not signed in to LENS, so the guide cannot be read. Ask them to sign in."
          : body.error || `The guide state could not be read (HTTP ${res.status}).`,
    };
  }

  const latest = body.latest;
  if (!latest || typeof latest.step !== "string") {
    return {
      guiding: false,
      reason:
        "No walkthrough is running — the guide has no step yet. Ask the student what they are trying to do on screen.",
    };
  }

  return {
    guiding: true,
    goal: typeof latest.goal === "string" ? latest.goal : "",
    step: latest.step,
    why: typeof latest.why === "string" ? latest.why : null,
    status: GUIDE_STATUSES.includes(latest.status as GuideStatus)
      ? (latest.status as GuideStatus)
      : "on_track",
  };
}

export function useAgent(tools: AgentTools) {
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<"webrtc" | "websocket" | null>(null);
  const [toolInFlight, setToolInFlight] = useState<string | null>(null);
  const [interruptions, setInterruptions] = useState(0);

  // Handlers are re-created every render by the calling component. The SDK
  // holds the clientTools object, so read through a ref to avoid registering
  // a stale closure over camera state.
  const toolsRef = useRef(tools);
  toolsRef.current = tools;

  const credentialRef = useRef<Credential | null>(null);
  const triedFallbackRef = useRef(false);
  const connectedRef = useRef(false);

  const append = useCallback((role: "user" | "agent", text: string) => {
    const trimmed = text?.trim();
    if (!trimmed) return;
    setTranscript((prev) => [
      ...prev,
      { id: nextId(), role, text: trimmed, at: Date.now() },
    ]);
  }, []);

  const clientTools = useMemo(
    () => ({
      /**
       * The agent's only way to see. One frame, captured at call time.
       * Result is stringified because the SDK sends tool results as text.
       */
      analyze_workspace: async (params: Record<string, unknown>) => {
        const objective =
          typeof params?.objective === "string" ? params.objective : "";
        setToolInFlight("analyze_workspace");
        try {
          const result = await toolsRef.current.analyzeWorkspace(objective);
          return JSON.stringify(result);
        } catch (err) {
          // Hand the agent the failure in words it can act on, rather than
          // letting the tool call hang or resolve to nothing.
          return JSON.stringify({
            error: err instanceof Error ? err.message : "Could not read the camera.",
            observation:
              "The camera frame could not be captured or analyzed. Ask the student to check the camera and try again.",
            objects: [],
            confidence: 0,
            changed: false,
          });
        } finally {
          setToolInFlight(null);
        }
      },

      set_pace: (params: Record<string, unknown>) => {
        const mode = asPace(params?.mode);
        toolsRef.current.setPace(mode);
        return `Pace set to ${mode}.`;
      },

      compare_to_reference: async (params: Record<string, unknown>) => {
        const objective = typeof params?.objective === "string" ? params.objective : "";
        setToolInFlight("compare_to_reference");
        try {
          const result = await toolsRef.current.compareToReference(objective);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : "Could not compare.",
            difference:
              "The comparison could not be made. Ask the student to load a reference video, or to check the camera.",
            focus: "",
            confidence: 0,
            aligned: false,
          });
        } finally {
          setToolInFlight(null);
        }
      },

      note_misconception: (params: Record<string, unknown>) => {
        const belief = typeof params?.belief === "string" ? params.belief : "";
        const rootCause = typeof params?.rootCause === "string" ? params.rootCause : "";
        const practice = typeof params?.practice === "string" ? params.practice : "";
        if (!belief.trim()) return "Invalid misconception note.";
        toolsRef.current.noteMisconception({ belief, rootCause, practice });
        return "Noted.";
      },

      set_mode: (params: Record<string, unknown>) => {
        const mode = asMode(params?.mode);
        toolsRef.current.setMode(mode);
        // The mode the tutor was in is part of what happened in the session,
        // so it goes in the event log next to the predictions and the
        // understanding notes — not only into React state, which is gone on
        // the next refresh. Fire-and-forget: a failed write must never
        // stall the agent mid-turn.
        void useLens.getState().recordEvent("mode_changed", { mode, source: "voice" });
        return `Mode set to ${mode}.`;
      },

      note_understanding: (params: Record<string, unknown>) => {
        const topic = typeof params?.topic === "string" ? params.topic : "";
        const why = typeof params?.why === "string" ? params.why : "";
        const raw = Number(params?.level);
        if (!topic.trim() || !Number.isFinite(raw)) return "Invalid understanding note.";
        toolsRef.current.noteUnderstanding({
          topic,
          level: Math.min(1, Math.max(0, raw)),
          why,
        });
        return "Noted.";
      },

      record_prediction: (params: Record<string, unknown>) => {
        const prediction =
          typeof params?.prediction === "string" ? params.prediction : "";
        if (!prediction.trim()) return "No prediction text supplied.";
        toolsRef.current.recordPrediction(prediction);
        return "Prediction recorded.";
      },

      /**
       * What the on-screen guide says to do next. The agent cannot see the
       * student's browser — the extension can, and it is already writing a
       * step per turn. This reads the latest one back.
       */
      read_guide_step: async (params: Record<string, unknown>) => {
        const raw = Number(params?.limit);
        const limit = Number.isFinite(raw) ? Math.min(20, Math.max(1, raw)) : 3;
        setToolInFlight("read_guide_step");
        try {
          // The extension's own session first — that is where the guide's
          // steps are recorded. The page's session is the fallback for the
          // case where the walkthrough was started from the app itself.
          const sessionId =
            toolsRef.current.guideSessionId?.() ??
            (await askExtensionForGuideSession()) ??
            useLens.getState().sessionId;
          return JSON.stringify(await readGuideStep(sessionId, limit));
        } finally {
          setToolInFlight(null);
        }
      },
    }),
    []
  );

  // Declared before useConversation so the callbacks below can reach the
  // conversation object without reading a still-uninitialised binding.
  const conversationRef = useRef<ReturnType<typeof useConversation> | null>(null);

  const conversation = useConversation({
    clientTools,
    onConnect: () => {
      connectedRef.current = true;
      setError(null);
      setPhase("listening");
    },
    onDisconnect: () => {
      const wasConnected = connectedRef.current;
      connectedRef.current = false;
      setTransport(null);

      // Never got up on WebRTC — fall back to the signed WebSocket URL once.
      if (!wasConnected && !triedFallbackRef.current && credentialRef.current?.signedUrl) {
        triedFallbackRef.current = true;
        setTransport("websocket");
        conversationRef.current?.startSession({
          signedUrl: credentialRef.current.signedUrl,
          connectionType: "websocket",
          clientTools,
        });
        return;
      }

      setPhase((prev) => (prev === "error" ? prev : "idle"));
    },
    onError: (message) => {
      if (!connectedRef.current && !triedFallbackRef.current && credentialRef.current?.signedUrl) {
        triedFallbackRef.current = true;
        setTransport("websocket");
        conversationRef.current?.startSession({
          signedUrl: credentialRef.current.signedUrl,
          connectionType: "websocket",
          clientTools,
        });
        return;
      }
      setError(message || "The conversation hit an error.");
      setPhase("error");
    },
    onMessage: ({ message, source, role }) => {
      append(role ?? (source === "user" ? "user" : "agent"), message);
    },
    onModeChange: ({ mode }) => {
      setPhase((prev) =>
        prev === "error" || prev === "connecting"
          ? prev
          : mode === "speaking"
            ? "speaking"
            : "listening"
      );
    },
    onInterruption: () => {
      // Barge-in worked. Surfaced so the demo can point at it.
      setInterruptions((n) => n + 1);
    },
    onUnhandledClientToolCall: (call) => {
      setError(
        `The agent called a tool this page does not implement: "${call?.tool_name ?? "unknown"}". Check the tool names in the ElevenLabs dashboard.`
      );
    },
  });

  conversationRef.current = conversation;

  const start = useCallback(async () => {
    setError(null);
    setTranscript([]);
    setInterruptions(0);
    setPhase("connecting");
    triedFallbackRef.current = false;
    connectedRef.current = false;

    let credential: Credential;
    try {
      const res = await fetch("/api/elevenlabs/signed-url", { cache: "no-store" });
      const payload = (await res.json()) as Partial<Credential> & { error?: string };
      if (!res.ok) throw new Error(payload.error || "Could not reach ElevenLabs.");
      credential = {
        conversationToken: payload.conversationToken ?? null,
        signedUrl: payload.signedUrl ?? null,
        warnings: payload.warnings ?? [],
      };
      if (credential.warnings.length) {
        setError(`ElevenLabs transport warning: ${credential.warnings.join("; ")}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the session.");
      setPhase("error");
      return;
    }

    // Credentials are minted first so a misconfigured agent reports itself
    // without costing the user a permission prompt. The microphone is the
    // SDK's to open, but asking now means the browser prompt lands before the
    // socket rather than in the middle of the agent's greeting.
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((track) => track.stop());
    } catch {
      setError(
        "Microphone access was denied. LENS is a spoken tutor — allow the mic and start again."
      );
      setPhase("error");
      return;
    }

    credentialRef.current = credential;

    if (credential.conversationToken) {
      setTransport("webrtc");
      conversation.startSession({
        conversationToken: credential.conversationToken,
        connectionType: "webrtc",
        clientTools,
      });
    } else if (credential.signedUrl) {
      triedFallbackRef.current = true;
      setTransport("websocket");
      conversation.startSession({
        signedUrl: credential.signedUrl,
        connectionType: "websocket",
        clientTools,
      });
    } else {
      setError("ElevenLabs returned no usable connection credential.");
      setPhase("error");
    }
  }, [conversation]);

  const stop = useCallback(() => {
    triedFallbackRef.current = true; // suppress fallback on a deliberate hangup
    connectedRef.current = false;
    conversationRef.current?.endSession();
    setTransport(null);
    setPhase("idle");
  }, []);

  useEffect(() => {
    return () => {
      triedFallbackRef.current = true;
      conversationRef.current?.endSession();
    };
  }, []);

  /**
   * Out-of-band context for the agent. Used to tell it the box is on screen
   * without pretending the student said anything.
   */
  const sendContext = useCallback(
    (text: string) => {
      if (conversationRef.current?.status !== "connected") return;
      conversationRef.current.sendContextualUpdate(text);
    },
    []
  );

  const status = conversation.status;

  return {
    start,
    stop,
    sendContext,
    setMuted: conversation.setMuted,
    isMuted: conversation.isMuted,
    status,
    phase:
      status === "connecting"
        ? ("connecting" as const)
        : status === "disconnected" && phase !== "error"
          ? ("idle" as const)
          : phase,
    transcript,
    error,
    transport,
    toolInFlight,
    interruptions,
  };
}
