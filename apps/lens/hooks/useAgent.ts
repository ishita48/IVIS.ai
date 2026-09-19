"use client";

/**
 * useAgent — the ElevenLabs conversation, and the three tools it can reach
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
  recordPrediction: (prediction: string) => void;
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

      record_prediction: (params: Record<string, unknown>) => {
        const prediction =
          typeof params?.prediction === "string" ? params.prediction : "";
        if (!prediction.trim()) return "No prediction text supplied.";
        toolsRef.current.recordPrediction(prediction);
        return "Prediction recorded.";
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
      });
    } else if (credential.signedUrl) {
      triedFallbackRef.current = true;
      setTransport("websocket");
      conversation.startSession({
        signedUrl: credential.signedUrl,
        connectionType: "websocket",
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
