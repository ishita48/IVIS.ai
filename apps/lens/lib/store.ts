"use client";

/**
 * LENS client store.
 * ─────────────────────────────────────────────────────────────────────
 * Rewritten from StudyO's store. What survived: sessions, sources, chat,
 * toasts — the plumbing that already worked. What replaced the study-tool
 * slices: the Guided Camera Mode state machine, the event log, the
 * reasoning state, and the metrics strip.
 *
 * ONE INVARIANT, and it is the product: nothing here is a number we
 * increment locally. `metrics` is refetched from /api/metrics, which
 * aggregates the real events collection. `reasoning` comes from a real
 * model call over real events. If you find yourself writing
 * `set({ hintsIssued: n + 1 })`, stop — record an event and let the
 * server count it. That is the difference between a demo a judge believes
 * and one they don't.
 */

import { create } from "zustand";
import type {
  CameraState,
  ConceptMap,
  LensEvent,
  LensEventType,
  LensMetrics,
  PointerTarget,
  ReasoningState,
  VisionObservation,
} from "./lens/contracts";

// ── Types ─────────────────────────────────────────────────────────────

export type SourceKind =
  | "pdf"
  | "youtube"
  | "webpage"
  | "brightspace"
  | "notion"
  | "confluence"
  | "dropbox";

export type Source = {
  _id: string;
  userId?: string;
  sessionId?: string | null;
  kind: SourceKind;
  title: string;
  url?: string | null;
  badge?: string | null;
  active: boolean;
  metadata?: {
    wordCount?: number;
    duration?: number | null;
    pageCount?: number | null;
    thumbnailUrl?: string | null;
    host?: string;
  };
  createdAt?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  chips?: string[];
};

export type SessionMeta = {
  _id: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
  sourceCount?: number;
};

export type WorkspaceView = "camera" | "pointer" | "reasoning" | "sources";

type Toast = { id: string; kind: "info" | "error" | "success"; text: string };

/** One question in the camera loop, and the student's answer once given. */
export type PendingQuestion = {
  question: string;
  options: string[];
  concept?: string | null;
  answer?: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────

export type StoredTurn = { id: string; role: "user" | "agent"; text: string; at: number };

const MAP_MIN_GAP_MS = 15_000;
let mapTimer: ReturnType<typeof setTimeout> | null = null;
let mapLastRunAt = 0;
let mapRunAgain = false;

const genId = () => Math.random().toString(36).slice(2, 9);
const CURRENT_SESSION_KEY = "lens:currentSessionId";

const welcomeChat: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    text: "Point your camera at whatever you're working on — a circuit, a notebook, a lab setup — and I'll watch you work. Or drop in a PDF and ask me about it. I won't give you answers, so don't bother asking.",
    chips: ["Open the camera", "Add a source", "What can you see?"],
  },
];

async function jsonFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ── State ─────────────────────────────────────────────────────────────

type LensState = {
  sessionId: string | null;
  bootstrapped: boolean;
  bootstrap: () => Promise<void>;
  pastSessions: SessionMeta[];
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  loadSessions: () => Promise<void>;
  newSession: () => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;

  sources: Source[];
  toggleSource: (id: string) => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  addYouTube: (url: string) => Promise<void>;
  addUrl: (url: string) => Promise<void>;
  bulkIngest: (urls: string[]) => Promise<{ added: number; total: number }>;
  captureTabs: () => Promise<number>;
  extensionConnected: boolean;
  setExtensionConnected: (v: boolean) => void;
  needsSourcesAt: number;

  chat: ChatMessage[];
  typing: boolean;
  sendUserPrompt: (text: string) => Promise<void>;

  view: WorkspaceView;
  setView: (v: WorkspaceView) => void;
  addSourceOpen: boolean;
  setAddSourceOpen: (v: boolean) => void;

  // ── Guided Camera Mode ──────────────────────────────────────────
  objective: string;
  setObjective: (s: string) => void;
  cameraState: CameraState;
  cameraActive: boolean;
  setCameraActive: (v: boolean) => void;
  observation: VisionObservation | null;
  previousObservation: string | null;
  analyzing: boolean;
  lastLatencyMs: number | null;
  pendingQuestion: PendingQuestion | null;

  analyzeFrame: (imageBase64: string, source?: "camera" | "upload") => Promise<void>;
  answerQuestion: (answer: string) => Promise<void>;
  answerUnderstandingCheck: (index: number) => Promise<void>;

  // ── Pointer ─────────────────────────────────────────────────────
  pointerTarget: PointerTarget | null;
  pointing: boolean;
  clearPointer: () => void;
  pointAtScreen: (question: string) => Promise<void>;

  // ── Reasoning + events + metrics ────────────────────────────────
  reasoning: ReasoningState | null;
  timeline: ReasoningState[];
  events: LensEvent[];
  metrics: LensMetrics | null;
  analyzingReasoning: boolean;
  /** Outcome of the last analysis, shown next to the Analyze now button. */
  reasoningNote: { kind: "updated" | "unchanged" | "skipped" | "insufficient" | "error"; text: string } | null;
  /** Run the reasoning engine over the session now and show the result. */
  analyzeReasoningNow: (opts?: {
    latestObservation?: string | null;
    spokenText?: string | null;
  }) => Promise<void>;
  /** The session's spoken transcript, loaded from saved voice_turn events. */
  transcript: StoredTurn[];
  refreshTranscript: () => Promise<void>;
  /** End of a live session: one last map update, then reload transcript + events. Deletes nothing. */
  finishSession: () => Promise<void>;
  conceptMap: ConceptMap | null;
  updatingMap: boolean;
  mapNote: { kind: "updated" | "nothing" | "skipped" | "error"; text: string } | null;
  refreshConceptMap: () => Promise<void>;
  /** Fold new student turns into the concept map now. */
  updateMapNow: () => Promise<void>;
  /** Same, throttled to once per 15s — for automatic triggers. */
  scheduleConceptMapUpdate: () => void;
  refreshReasoning: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  refreshMetrics: () => Promise<void>;
  recordEvent: (
    type: LensEventType,
    payload?: Record<string, unknown>,
    concept?: string | null
  ) => Promise<void>;

  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  _loadSessionData: (sessionId: string) => Promise<void>;
};

export const useLens = create<LensState>((set, get) => ({
  sessionId: null,
  bootstrapped: false,
  pastSessions: [],
  sidebarOpen: true,
  sources: [],
  chat: welcomeChat,
  typing: false,
  view: "camera",
  addSourceOpen: false,
  extensionConnected: false,
  needsSourcesAt: 0,

  objective: "",
  cameraState: "IDLE",
  cameraActive: false,
  observation: null,
  previousObservation: null,
  analyzing: false,
  lastLatencyMs: null,
  pendingQuestion: null,

  pointerTarget: null,
  pointing: false,

  reasoning: null,
  analyzingReasoning: false,
  reasoningNote: null,
  transcript: [],
  conceptMap: null,
  updatingMap: false,
  mapNote: null,
  timeline: [],
  events: [],
  metrics: null,

  toasts: [],

  // ── Toasts ────────────────────────────────────────────────────────
  pushToast: (t) => {
    const id = genId();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setView: (view) => set({ view }),
  setAddSourceOpen: (addSourceOpen) => set({ addSourceOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setObjective: (objective) => set({ objective }),
  setCameraActive: (cameraActive) =>
    set({ cameraActive, cameraState: cameraActive ? "OBSERVE" : "IDLE" }),
  setExtensionConnected: (v) => set({ extensionConnected: v }),
  clearPointer: () => set({ pointerTarget: null }),

  // ── Session plumbing ──────────────────────────────────────────────
  _loadSessionData: async (sessionId: string) => {
    const [sources, messages] = await Promise.all([
      jsonFetch<any[]>(`/api/sources?sessionId=${sessionId}`).catch(() => []),
      jsonFetch<any[]>(`/api/chat?sessionId=${sessionId}`).catch(() => []),
    ]);

    set({
      sessionId,
      sources: (sources || []).map((s: any) => ({ ...s, _id: String(s._id) })),
      chat:
        Array.isArray(messages) && messages.length
          ? messages.map((m: any) => ({
              id: String(m._id),
              role: m.role,
              text: m.text,
              chips: m.chips ?? undefined,
            }))
          : welcomeChat,
      // A session switch must not leave the previous student model on
      // screen — every LENS surface is session-scoped.
      observation: null,
      previousObservation: null,
      pendingQuestion: null,
      pointerTarget: null,
      cameraState: "IDLE",
    });

    if (typeof window !== "undefined") {
      sessionStorage.setItem(CURRENT_SESSION_KEY, sessionId);
    }

    await Promise.all([
      get().refreshReasoning(),
      get().refreshEvents(),
      get().refreshMetrics(),
      get().refreshConceptMap(),
      get().refreshTranscript(),
    ]);
  },

  loadSessions: async () => {
    try {
      const { sessions } = await jsonFetch<{ sessions: any[] }>(
        "/api/sessions?status=active&limit=50"
      );
      set({
        pastSessions: (sessions || []).map((s: any) => ({
          _id: String(s._id),
          title: s.title || "New session",
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
          sourceCount: s.sourceIds?.length || 0,
        })),
      });
    } catch (e) {
      console.warn("[loadSessions]", e);
    }
  },

  bootstrap: async () => {
    try {
      await fetch("/api/user", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      await get().loadSessions();

      const stored =
        typeof window !== "undefined"
          ? sessionStorage.getItem(CURRENT_SESSION_KEY)
          : null;
      const resume =
        stored && get().pastSessions.some((s) => s._id === stored) ? stored : null;

      if (resume) {
        await get()._loadSessionData(resume);
      } else {
        // Lazy session: no DB row until the student does something. The
        // first write route calls resolveOrCreateSession and returns an id.
        if (typeof window !== "undefined")
          sessionStorage.removeItem(CURRENT_SESSION_KEY);
        set({ sessionId: null, sources: [], chat: welcomeChat });
      }
      set({ bootstrapped: true });
    } catch (e) {
      console.error("[bootstrap]", e);
      set({ bootstrapped: true });
      get().pushToast({
        kind: "error",
        text: "Couldn't load your session. Check MONGODB_URI and Clerk keys.",
      });
    }
  },

  newSession: async () => {
    if (typeof window !== "undefined")
      sessionStorage.removeItem(CURRENT_SESSION_KEY);
    set({
      sessionId: null,
      sources: [],
      chat: welcomeChat,
      observation: null,
      previousObservation: null,
      pendingQuestion: null,
      pointerTarget: null,
      reasoning: null,
      timeline: [],
      events: [],
      metrics: null,
      conceptMap: null,
      transcript: [],
      mapNote: null,
      cameraState: "IDLE",
      view: "camera",
    });
  },

  switchSession: async (id) => {
    if (get().sessionId === id) return;
    try {
      await get()._loadSessionData(id);
      await get().loadSessions();
    } catch (e: any) {
      get().pushToast({
        kind: "error",
        text: e?.message || "Couldn't open that session",
      });
    }
  },

  renameSession: async (id, title) => {
    const clean = (title || "").trim().slice(0, 120);
    if (!clean) return;
    set((s) => ({
      pastSessions: s.pastSessions.map((x) =>
        x._id === id ? { ...x, title: clean } : x
      ),
    }));
    try {
      await jsonFetch("/api/sessions", {
        method: "PATCH",
        body: JSON.stringify({ id, title: clean }),
      });
    } catch {
      get().pushToast({ kind: "error", text: "Couldn't rename session" });
      await get().loadSessions();
    }
  },

  deleteSession: async (id) => {
    const prev = get().pastSessions;
    set({ pastSessions: prev.filter((s) => s._id !== id) });
    try {
      await fetch(`/api/sessions?id=${id}&mode=hard`, { method: "DELETE" });
      if (get().sessionId === id) await get().newSession();
    } catch {
      set({ pastSessions: prev });
      get().pushToast({ kind: "error", text: "Couldn't delete session" });
    }
  },

  // ── Sources ───────────────────────────────────────────────────────
  toggleSource: async (id) => {
    const src = get().sources.find((s) => s._id === id);
    if (!src) return;
    const active = !src.active;
    set((s) => ({
      sources: s.sources.map((x) => (x._id === id ? { ...x, active } : x)),
    }));
    try {
      await jsonFetch(`/api/sources`, {
        method: "PATCH",
        body: JSON.stringify({ id, active }),
      });
    } catch {
      set((s) => ({
        sources: s.sources.map((x) =>
          x._id === id ? { ...x, active: !active } : x
        ),
      }));
    }
  },

  removeSource: async (id) => {
    const prev = get().sources;
    set({ sources: prev.filter((s) => s._id !== id) });
    try {
      await fetch(`/api/sources?id=${id}`, { method: "DELETE" });
    } catch {
      set({ sources: prev });
      get().pushToast({ kind: "error", text: "Couldn't remove source" });
    }
  },

  uploadFile: async (file) => {
    const { sessionId } = get();
    const form = new FormData();
    form.append("file", file);
    if (sessionId) form.append("sessionId", sessionId);
    get().pushToast({ kind: "info", text: `Reading ${file.name}…` });
    try {
      const { source, sessionId: sid } = await jsonFetch<{
        source: any;
        sessionId: string;
      }>("/api/sources/upload", { method: "POST", body: form });
      await adoptSource(set, get, source, sid, sessionId);
    } catch (e: any) {
      get().pushToast({ kind: "error", text: e.message || "Upload failed" });
    }
  },

  addYouTube: async (url) => {
    const { sessionId } = get();
    get().pushToast({ kind: "info", text: "Fetching transcript…" });
    try {
      const { source, sessionId: sid } = await jsonFetch<{
        source: any;
        sessionId: string;
      }>("/api/sources/youtube", {
        method: "POST",
        body: JSON.stringify({ url, sessionId }),
      });
      await adoptSource(set, get, source, sid, sessionId);
    } catch (e: any) {
      get().pushToast({
        kind: "error",
        text: e.message || "Couldn't fetch transcript",
      });
    }
  },

  addUrl: async (url) => {
    const { sessionId } = get();
    get().pushToast({ kind: "info", text: "Reading page…" });
    try {
      const { source, sessionId: sid } = await jsonFetch<{
        source: any;
        sessionId: string;
      }>("/api/sources/url", {
        method: "POST",
        body: JSON.stringify({ url, sessionId }),
      });
      await adoptSource(set, get, source, sid, sessionId);
    } catch (e: any) {
      get().pushToast({ kind: "error", text: e.message || "Couldn't read that URL" });
    }
  },

  bulkIngest: async (urls) => {
    const { sessionId } = get();
    try {
      const res = await jsonFetch<{
        added: number;
        total: number;
        sessionId: string;
      }>("/api/sources/bulk", {
        method: "POST",
        body: JSON.stringify({ urls, sessionId }),
      });
      if (res.sessionId) {
        set({ sessionId: res.sessionId });
        await get()._loadSessionData(res.sessionId);
      }
      return { added: res.added, total: res.total };
    } catch (e: any) {
      get().pushToast({ kind: "error", text: e.message || "Bulk ingest failed" });
      return { added: 0, total: urls.length };
    }
  },

  captureTabs: async () => {
    if (typeof window === "undefined") return 0;
    window.postMessage(
      { source: "lens-app", type: "CAPTURE_TABS", sessionId: get().sessionId },
      window.location.origin
    );
    return 0;
  },

  // ── Tutor chat ────────────────────────────────────────────────────
  sendUserPrompt: async (text) => {
    const clean = text.trim();
    if (!clean) return;

    const userMsg: ChatMessage = { id: genId(), role: "user", text: clean };
    const replyId = genId();
    // The tutor's last real message is context for a vague reply ("I don't get it").
    const tutorContext =
      [...get().chat].reverse().find((m) => m.role === "assistant" && m.text && m.id !== "welcome")
        ?.text ?? null;
    set((s) => ({
      chat: [...s.chat, userMsg, { id: replyId, role: "assistant", text: "" }],
      typing: true,
    }));

    // Student chat is evidence, same as speech; tutor replies are not saved.
    // Awaited so a brand-new session has its id before the request below.
    await get().recordEvent("voice_turn", {
      role: "user",
      text: clean,
      at: Date.now(),
      source: "chat",
      tutorContext: tutorContext?.slice(0, 400) ?? null,
    });
    if (clean.length >= 12) get().scheduleConceptMapUpdate();

    try {
      const res = await fetch("/api/master/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: clean,
          sessionId: get().sessionId,
          history: get()
            .chat.slice(-10)
            .filter((m) => m.text)
            .map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
          const evLine = frame.match(/^event: (.+)$/m);
          const dataLine = frame.match(/^data: (.+)$/m);
          if (!evLine || !dataLine) continue;
          let payload: any;
          try {
            payload = JSON.parse(dataLine[1]);
          } catch {
            continue;
          }

          if (evLine[1] === "delta") {
            set((s) => ({
              chat: s.chat.map((m) =>
                m.id === replyId ? { ...m, text: m.text + payload.text } : m
              ),
            }));
          } else if (evLine[1] === "tool_call") {
            handleToolCall(get, payload);
          } else if (evLine[1] === "error") {
            set((s) => ({
              chat: s.chat.map((m) =>
                m.id === replyId ? { ...m, text: payload.text } : m
              ),
            }));
          }
        }
      }
    } catch (e: any) {
      set((s) => ({
        chat: s.chat.map((m) =>
          m.id === replyId
            ? { ...m, text: e?.message || "LENS couldn't reach the model." }
            : m
        ),
      }));
    } finally {
      set({ typing: false });
    }
  },

  // ── Guided Camera Mode ────────────────────────────────────────────
  /**
   * OBSERVE → IDENTIFY_NEXT_STEP → POINT → ASK, in one call.
   *
   * Two network round trips, in order, because the reasoning engine needs
   * the observation as input: analyze the frame, then reconstruct the
   * student model from the event that call just wrote.
   */
  analyzeFrame: async (imageBase64, source = "camera") => {
    if (get().analyzing) return;
    set({ analyzing: true, cameraState: "OBSERVE" });

    try {
      const res = await jsonFetch<{
        observation: VisionObservation;
        latencyMs: number;
        sessionId: string;
      }>("/api/vision/analyze", {
        method: "POST",
        body: JSON.stringify({
          image: imageBase64,
          sessionId: get().sessionId,
          objective: get().objective || undefined,
          previousObservation: get().previousObservation,
          source,
        }),
      });

      const wasFirst = !get().sessionId;
      set({
        sessionId: res.sessionId,
        observation: res.observation,
        lastLatencyMs: res.latencyMs,
        cameraState: res.observation.boundingBox ? "POINT" : "IDENTIFY_NEXT_STEP",
      });
      if (wasFirst) {
        if (typeof window !== "undefined")
          sessionStorage.setItem(CURRENT_SESSION_KEY, res.sessionId);
        get().loadSessions();
      }

      // IDENTIFY_NEXT_STEP — run the engine over the real event log.
      set({ cameraState: "IDENTIFY_NEXT_STEP" });
      const analysis = await jsonFetch<{ state?: ReasoningState }>(
        "/api/reasoning/analyze",
        {
          method: "POST",
          body: JSON.stringify({
            sessionId: res.sessionId,
            objective: get().objective || undefined,
            latestObservation: res.observation.observation,
          }),
        }
      );
      // No state when the engine skipped this as not in the student's notes.
      const state = analysis.state ?? null;

      // ASK — prefer the reasoning engine's question (it has the whole
      // history); fall back to the vision model's, which only saw a frame.
      const question =
        state?.understandingCheck?.question || res.observation.suggestedQuestion || null;
      const options =
        state?.understandingCheck?.options || res.observation.suggestedOptions || [];

      set({
        reasoning: state ?? get().reasoning,
        pendingQuestion:
          question && options.length
            ? { question, options, concept: res.observation.possibleIssue ?? null }
            : null,
        cameraState: question ? "ASK" : "NEXT_STEP",
        previousObservation: res.observation.observation,
      });

      await Promise.all([get().refreshEvents(), get().refreshMetrics()]);
    } catch (e: any) {
      // Loud failure by design. A silent fallback here is how a demo ends
      // up showing a stale observation with nobody noticing.
      set({ cameraState: "IDLE" });
      get().pushToast({ kind: "error", text: e?.message || "Vision call failed" });
    } finally {
      set({ analyzing: false });
    }
  },

  answerQuestion: async (answer) => {
    const q = get().pendingQuestion;
    if (!q) return;

    set({ cameraState: "WAIT_FOR_STUDENT", pendingQuestion: { ...q, answer } });

    await get().recordEvent(
      "prediction",
      { question: q.question, answer, options: q.options },
      q.concept ?? null
    );

    // The prediction is new evidence — re-derive the student model from it.
    set({ cameraState: "UPDATE_STUDENT_MODEL" });
    await get().refreshReasoning();
    await Promise.all([get().refreshEvents(), get().refreshMetrics()]);
    set({ cameraState: "VERIFY", pendingQuestion: null });
  },

  answerUnderstandingCheck: async (index) => {
    const check = get().reasoning?.understandingCheck;
    if (!check) return;

    const correct = index === check.correctIndex;
    await get().recordEvent("understanding_check_answered", {
      question: check.question,
      answer: check.options[index],
      correct,
      rationale: check.rationale,
    });

    get().pushToast({
      kind: correct ? "success" : "info",
      // A wrong answer never gets the fact handed over — the next
      // reasoning pass escalates one rung and re-asks a simpler version.
      text: correct ? "Got it." : "Not quite — let's come at that differently.",
    });

    await get().refreshReasoning();
    await Promise.all([get().refreshEvents(), get().refreshMetrics()]);
  },

  // ── Pointer ───────────────────────────────────────────────────────
  pointAtScreen: async (question) => {
    set({ pointing: true, pointerTarget: null });
    try {
      const { capturePointerFrame } = await import("@/hooks/usePointer");
      const frame = await capturePointerFrame();
      if (!frame) {
        get().pushToast({ kind: "error", text: "Screen capture was cancelled." });
        return;
      }

      const { target, sessionId } = await jsonFetch<{
        target: PointerTarget | null;
        sessionId: string;
      }>("/api/pointer/screen", {
        method: "POST",
        body: JSON.stringify({
          image: frame.dataUrl,
          question,
          sessionId: get().sessionId,
          declaredWidth: frame.declared.width,
          declaredHeight: frame.declared.height,
          captureWidth: frame.capture.width,
          captureHeight: frame.capture.height,
        }),
      });

      set({ sessionId, pointerTarget: target });
      if (!target) {
        get().pushToast({
          kind: "info",
          text: "Nothing specific on screen to point at — that one's conceptual.",
        });
      }
      await get().refreshEvents();
    } catch (e: any) {
      get().pushToast({ kind: "error", text: e?.message || "Pointer failed" });
    } finally {
      set({ pointing: false });
    }
  },

  // ── Derived state refreshers ──────────────────────────────────────
  analyzeReasoningNow: async (opts = {}) => {
    const sessionId = get().sessionId;
    if (!sessionId || get().analyzingReasoning) return;
    set({ analyzingReasoning: true, reasoningNote: null });
    try {
      const res = await jsonFetch<{
        state?: ReasoningState;
        outcome?: "created" | "updated" | "unchanged" | "insufficient";
        skipped?: "not_in_notes";
      }>(
        "/api/reasoning/analyze",
        {
          method: "POST",
          body: JSON.stringify({
            sessionId,
            objective: get().objective || undefined,
            latestObservation:
              opts.latestObservation ?? get().observation?.observation ?? null,
            spokenText: opts.spokenText ?? null,
          }),
        }
      );
      if (res.skipped || !res.state) {
        // Never added to the timeline — only a note beside the button.
        set({ reasoningNote: { kind: "skipped", text: "Not related to your notes, skipped" } });
        return;
      }
      set({ reasoning: res.state });
      // The Reasoning tab renders the persisted timeline, so re-read it.
      await Promise.all([get().refreshReasoning(), get().refreshEvents()]);
      const note =
        res.outcome === "unchanged"
          ? { kind: "unchanged" as const, text: "No new evidence since last analysis" }
          : res.outcome === "insufficient"
          ? { kind: "insufficient" as const, text: "Not enough evidence yet" }
          : { kind: "updated" as const, text: "Updated just now" };
      set({ reasoningNote: note });
      if (note.kind === "updated" || note.kind === "unchanged") {
        // "just now" goes stale — clear it unless a newer run replaced it.
        setTimeout(() => {
          if (get().reasoningNote === note) set({ reasoningNote: null });
        }, 10000);
      }
    } catch (e: any) {
      set({
        reasoningNote: { kind: "error", text: String(e?.message || "Analysis failed").slice(0, 120) },
      });
    } finally {
      set({ analyzingReasoning: false });
    }
  },

  refreshTranscript: async () => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    try {
      const { events } = await jsonFetch<{ events: LensEvent[] }>(
        `/api/events?sessionId=${sessionId}&type=voice_turn&limit=1000`
      );
      // Ignore a late response for a session the user has since left.
      if (get().sessionId !== sessionId) return;
      set({
        transcript: (events || []).map((e) => {
          const p = e.payload as { role?: string; text?: string; at?: number };
          const at = typeof p.at === "number" ? p.at : Date.parse(e.timestamp);
          return {
            id: e._id ?? `${p.role}-${at}`,
            role: p.role === "user" ? "user" : "agent",
            text: String(p.text ?? ""),
            at,
          };
        }),
      });
    } catch {
      /* non-fatal — the live transcript is still on screen */
    }
  },

  finishSession: async () => {
    if (!get().sessionId) return;
    // Drop the debounce: the final run happens now, not up to 15s from now.
    if (mapTimer) {
      clearTimeout(mapTimer);
      mapTimer = null;
    }
    mapRunAgain = false;
    // Let an in-flight run finish so the final one sees the last turns.
    for (let i = 0; i < 200 && get().updatingMap; i++) {
      await new Promise((r) => setTimeout(r, 300));
    }
    await get().updateMapNow();
    await Promise.all([get().refreshTranscript(), get().refreshEvents(), get().refreshMetrics()]);
  },

  refreshConceptMap: async () => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    try {
      const { map } = await jsonFetch<{ map: ConceptMap | null }>(
        `/api/concept-map?sessionId=${sessionId}`
      );
      set({ conceptMap: map });
    } catch {
      /* non-fatal — the map just isn't shown */
    }
  },

  updateMapNow: async () => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    if (get().updatingMap) {
      mapRunAgain = true; // new turns arrived mid-run; go again when this one ends
      return;
    }
    set({ updatingMap: true, mapNote: null });
    try {
      const res = await jsonFetch<{
        outcome: "updated" | "nothing_new" | "skipped";
        map: ConceptMap;
      }>("/api/concept-map", { method: "POST", body: JSON.stringify({ sessionId }) });
      set({ conceptMap: res.map });
      const note =
        res.outcome === "updated"
          ? { kind: "updated" as const, text: "Updated just now" }
          : res.outcome === "skipped"
          ? { kind: "skipped" as const, text: "Not related to your notes, skipped" }
          : { kind: "nothing" as const, text: "Nothing new" };
      set({ mapNote: note });
      if (note.kind !== "skipped") {
        // "just now" goes stale — clear it unless a newer run replaced it.
        setTimeout(() => {
          if (get().mapNote === note) set({ mapNote: null });
        }, 10000);
      }
    } catch (e: any) {
      set({ mapNote: { kind: "error", text: String(e?.message || "Update failed").slice(0, 120) } });
    } finally {
      set({ updatingMap: false });
      if (mapRunAgain) {
        mapRunAgain = false;
        get().scheduleConceptMapUpdate();
      }
    }
  },

  scheduleConceptMapUpdate: () => {
    if (mapTimer) return;
    const wait = Math.max(0, MAP_MIN_GAP_MS - (Date.now() - mapLastRunAt));
    mapTimer = setTimeout(() => {
      mapTimer = null;
      mapLastRunAt = Date.now();
      void get().updateMapNow();
    }, wait);
  },

  refreshReasoning: async () => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    try {
      const { timeline, state } = await jsonFetch<{
        timeline: ReasoningState[];
        state: ReasoningState | null;
      }>(`/api/reasoning?sessionId=${sessionId}&timeline=1`);
      set({ timeline: timeline || [], reasoning: state ?? get().reasoning });
    } catch {
      /* non-fatal — the graph just doesn't advance this tick */
    }
  },

  refreshEvents: async () => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    try {
      const { events } = await jsonFetch<{ events: LensEvent[] }>(
        `/api/events?sessionId=${sessionId}&limit=60`
      );
      set({ events: events || [] });
    } catch {}
  },

  refreshMetrics: async () => {
    const sessionId = get().sessionId;
    if (!sessionId) return;
    try {
      const { metrics } = await jsonFetch<{ metrics: LensMetrics }>(
        `/api/metrics?sessionId=${sessionId}`
      );
      set({ metrics });
    } catch {}
  },

  recordEvent: async (type, payload = {}, concept = null) => {
    try {
      const { sessionId } = await jsonFetch<{ id: string; sessionId: string }>(
        "/api/events",
        {
          method: "POST",
          body: JSON.stringify({
            type,
            payload,
            concept,
            sessionId: get().sessionId,
          }),
        }
      );
      if (sessionId && sessionId !== get().sessionId) set({ sessionId });
    } catch (e) {
      console.warn("[recordEvent]", e);
    }
  },
}));

// ── Internals ─────────────────────────────────────────────────────────

/** Shared tail of every add-source action. */
async function adoptSource(
  set: any,
  get: () => LensState,
  source: any,
  newSessionId: string,
  prevSessionId: string | null
) {
  set((s: LensState) => ({
    sessionId: newSessionId,
    sources: [...s.sources, { ...source, _id: String(source._id) } as Source],
  }));
  if (newSessionId && !prevSessionId) {
    if (typeof window !== "undefined")
      sessionStorage.setItem(CURRENT_SESSION_KEY, newSessionId);
    get().loadSessions();
  }
  get().pushToast({ kind: "success", text: `Added: ${source.title}` });
}

/**
 * Tool calls streamed by the LENS agent. Deliberately thin: a tool moves
 * the UI somewhere or primes a capture. It never fabricates a result —
 * the work still goes through the same real endpoints the buttons use,
 * and the camera is never switched on without a human tap.
 */
function handleToolCall(get: () => LensState, call: { tool: string; args?: any }) {
  const s = get();
  switch (call.tool) {
    case "REQUEST_CAMERA":
      if (call.args?.objective) s.setObjective(call.args.objective);
      s.setView("camera");
      s.pushToast({ kind: "info", text: "Point your camera at it and tap Analyze." });
      break;
    case "ANALYZE_FRAME":
      if (call.args?.objective) s.setObjective(call.args.objective);
      s.setView("camera");
      break;
    case "POINT_AT":
      s.setView("pointer");
      if (call.args?.question) s.pointAtScreen(call.args.question);
      break;
    case "CREATE_EXPERIMENT":
      s.setView("reasoning");
      break;
    case "NAVIGATE":
      if (["camera", "pointer", "reasoning", "sources"].includes(call.args?.tab)) {
        s.setView(call.args.tab as WorkspaceView);
      }
      break;
  }
}

/** Back-compat alias so components ported from StudyO keep resolving. */
export const useStudio = useLens;
