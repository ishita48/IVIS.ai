/**
 * Deepgram think-aloud — what the student said, stamped against what LENS
 * was doing when they started saying it.
 * ─────────────────────────────────────────────────────────────────────
 * Browser-only. Nothing here imports a server module.
 *
 * ElevenLabs already transcribes the student, so a second transcript on its
 * own is worth nothing. The capability this module adds is the stamp: every
 * final utterance carries the analyze/vision call that was in flight at the
 * moment the student began speaking, so "I thought the LED was backwards"
 * can be replayed against the exact frame LENS was looking at.
 *
 * Two halves, deliberately separable:
 *
 *   1. The call ledger — `beginCall()` / `trackCall()`. Whoever fires
 *      /api/vision/analyze or /api/reasoning/analyze marks the call here.
 *      This half has no Deepgram in it and can be unit-tested dry.
 *
 *   2. The socket — `startThinkAloud()`. Streams mic audio to Deepgram over
 *      a websocket and, on each final result, looks up the ledger at the
 *      utterance's start time and persists a `voice_turn` event through
 *      POST /api/events (the same route CameraView already uses).
 *
 * Utterance timing comes from Deepgram itself: each result carries `start`
 * and `duration` in seconds of audio since the stream opened. That is more
 * honest than the arrival time of the message, which lags the speech by the
 * endpointing window.
 *
 * Mic contention: hooks/useAgent.ts takes getUserMedia({audio:true}) and the
 * ElevenLabs SDK then owns the live mic over WebRTC. Opening a second
 * MediaRecorder on the same device works in Chrome but double-captures the
 * same audio during a live conversation. Pass an existing `stream` to reuse
 * the ElevenLabs track, or accept the double capture and test with a
 * session actually running.
 */

// ── Call ledger ───────────────────────────────────────────────────────

export type InFlightKind = "vision" | "analyze";

export type InFlightCall = {
  id: string;
  kind: InFlightKind;
  /** Wall clock, ms since epoch. */
  startedAt: number;
  /** Null while the call is still running. */
  endedAt: number | null;
  /** Whatever the caller wants replayed later: objective, frame index, route. */
  meta: Record<string, unknown>;
};

/** Calls older than this are forgotten. Utterances never start this far back. */
const LEDGER_RETENTION_MS = 5 * 60_000;
const LEDGER_MAX = 200;

const ledger: InFlightCall[] = [];

function prune(now: number) {
  while (
    ledger.length > LEDGER_MAX ||
    (ledger.length && ledger[0].endedAt !== null && now - ledger[0].endedAt! > LEDGER_RETENTION_MS)
  ) {
    ledger.shift();
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mark a model call as in flight. Returns the function that marks it done.
 * Call it in `finally`, so a rejected call still gets an end time.
 */
export function beginCall(kind: InFlightKind, meta: Record<string, unknown> = {}): () => void {
  const now = Date.now();
  prune(now);
  const call: InFlightCall = { id: newId(), kind, startedAt: now, endedAt: null, meta };
  ledger.push(call);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    call.endedAt = Date.now();
  };
}

/** `beginCall` wrapped around a promise — the one-line form for fetch call sites. */
export async function trackCall<T>(
  kind: InFlightKind,
  run: () => Promise<T>,
  meta: Record<string, unknown> = {}
): Promise<T> {
  const end = beginCall(kind, meta);
  try {
    return await run();
  } finally {
    end();
  }
}

/**
 * The call that was running at wall-clock time `at`. When calls overlap the
 * most recently started one wins — that is the one the student is reacting
 * to. Null when LENS was idle.
 */
export function callInFlightAt(at: number): InFlightCall | null {
  for (let i = ledger.length - 1; i >= 0; i--) {
    const c = ledger[i];
    if (c.startedAt <= at && (c.endedAt === null || at <= c.endedAt)) return c;
  }
  return null;
}

/** Read-only view, oldest first. For tests and the debug panel. */
export function ledgerSnapshot(): readonly InFlightCall[] {
  return ledger.slice();
}

/** Forget every call. Tests call this between cases. */
export function resetLedger() {
  ledger.length = 0;
}

// ── Utterances ────────────────────────────────────────────────────────

export type Utterance = {
  text: string;
  confidence: number;
  /** Wall clock the student started speaking, derived from Deepgram's audio offset. */
  startedAt: number;
  endedAt: number;
  /** The call in flight at `startedAt`, or null if LENS was idle. */
  inFlight: InFlightCall | null;
};

/**
 * The subset of a Deepgram `Results` message this module reads.
 * https://developers.deepgram.com/reference/speech-to-text-api/listen-streaming
 */
export type DeepgramResults = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  /** Seconds of audio from stream open to the start of this segment. */
  start?: number;
  /** Seconds of audio this segment covers. */
  duration?: number;
  channel?: {
    alternatives?: Array<{ transcript?: string; confidence?: number }>;
  };
};

/**
 * Turn one final Deepgram result into a stamped utterance. Pure: given the
 * message and the wall clock at which audio started flowing, it consults the
 * ledger and nothing else. Returns null for interim or empty results.
 */
export function stampUtterance(
  msg: DeepgramResults,
  audioStartedAt: number,
  lookup: (at: number) => InFlightCall | null = callInFlightAt
): Utterance | null {
  if (msg.type && msg.type !== "Results") return null;
  if (!msg.is_final) return null;
  const alt = msg.channel?.alternatives?.[0];
  const text = alt?.transcript?.trim() ?? "";
  if (!text) return null;

  const startedAt = audioStartedAt + Math.round((msg.start ?? 0) * 1000);
  const endedAt = startedAt + Math.round((msg.duration ?? 0) * 1000);
  return {
    text,
    confidence: typeof alt?.confidence === "number" ? alt.confidence : 0,
    startedAt,
    endedAt,
    inFlight: lookup(startedAt),
  };
}

/** Payload written to the `voice_turn` event. Keeps the shape lib/live-sessions.ts reads. */
export function utteranceToEventPayload(u: Utterance): Record<string, unknown> {
  return {
    role: "user",
    channel: "think_aloud",
    source: "deepgram",
    text: u.text,
    at: u.startedAt,
    endedAt: u.endedAt,
    confidence: u.confidence,
    inFlight: u.inFlight
      ? {
          callId: u.inFlight.id,
          kind: u.inFlight.kind,
          startedAt: u.inFlight.startedAt,
          endedAt: u.inFlight.endedAt,
          meta: u.inFlight.meta,
        }
      : null,
  };
}

// ── Socket ────────────────────────────────────────────────────────────

export type ThinkAloudOptions = {
  /** Session to persist against. Omitted: /api/events creates one lazily. */
  sessionId?: string | null;
  /**
   * Reuse a mic stream instead of opening a second one. Hand in the track
   * ElevenLabs is already using and there is no double capture.
   */
  stream?: MediaStream;
  /** Set false to keep utterances in memory only. Default true. */
  persist?: boolean;
  onUtterance?: (u: Utterance) => void;
  /** Interim results, for a live caption. Not persisted. */
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
};

export type ThinkAloud = {
  stop: () => void;
  /** Newest last. */
  utterances: readonly Utterance[];
};

type TokenResponse = {
  accessToken?: string;
  listenUrl?: string;
  model?: string;
  error?: string;
};

const RECORDER_SLICE_MS = 250;

let active: { stop: () => void } | null = null;

/** True when a think-aloud socket is open. */
export function thinkAloudRunning(): boolean {
  return active !== null;
}

/**
 * Open the socket and start streaming. Rejects if the token route is
 * unreachable, the mic is denied, or a session is already running.
 */
export async function startThinkAloud(opts: ThinkAloudOptions = {}): Promise<ThinkAloud> {
  if (active) throw new Error("Think-aloud is already running.");
  if (typeof window === "undefined") throw new Error("Think-aloud runs in the browser only.");

  const res = await fetch("/api/deepgram", { cache: "no-store" });
  const token = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !token.accessToken) {
    throw new Error(token.error || "Could not mint a Deepgram token.");
  }

  const ownsStream = !opts.stream;
  const stream = opts.stream ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));

  const url = new URL(token.listenUrl || "wss://api.deepgram.com/v1/listen");
  url.searchParams.set("model", token.model || "nova-3");
  url.searchParams.set("interim_results", "true");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");

  // Browsers cannot set an Authorization header on a websocket; Deepgram
  // reads the credential from the subprotocol list instead.
  const socket = new WebSocket(url.toString(), ["bearer", token.accessToken]);

  const utterances: Utterance[] = [];
  let recorder: MediaRecorder | null = null;
  let audioStartedAt = 0;
  let stopped = false;

  const persist = opts.persist ?? true;
  const sessionId = opts.sessionId ?? null;

  const fail = (message: string) => {
    opts.onError?.(message);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    active = null;
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // A recorder that is already gone is fine.
    }
    if (socket.readyState === WebSocket.OPEN) {
      // Tells Deepgram to flush the last segment before closing.
      socket.send(JSON.stringify({ type: "CloseStream" }));
    }
    socket.close();
    if (ownsStream) stream.getTracks().forEach((t) => t.stop());
    opts.onClose?.();
  };

  socket.onopen = () => {
    try {
      recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    } catch (err) {
      fail(err instanceof Error ? err.message : "MediaRecorder is unavailable.");
      stop();
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(e.data);
    };
    audioStartedAt = Date.now();
    recorder.start(RECORDER_SLICE_MS);
  };

  socket.onmessage = (e) => {
    let msg: DeepgramResults;
    try {
      msg = JSON.parse(String(e.data)) as DeepgramResults;
    } catch {
      return;
    }
    if (msg.type && msg.type !== "Results") return;

    const u = stampUtterance(msg, audioStartedAt);
    if (!u) {
      const interim = msg.channel?.alternatives?.[0]?.transcript?.trim();
      if (interim) opts.onInterim?.(interim);
      return;
    }

    utterances.push(u);
    opts.onUtterance?.(u);

    if (persist) {
      void fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "voice_turn",
          sessionId,
          payload: utteranceToEventPayload(u),
        }),
      }).catch((err) => {
        fail(err instanceof Error ? err.message : "Could not persist the utterance.");
      });
    }
  };

  socket.onerror = () => {
    fail("Deepgram socket error. Check DEEPGRAM_API_KEY and the browser console.");
  };

  socket.onclose = (ev) => {
    if (!stopped) {
      if (ev.code !== 1000) fail(`Deepgram closed the socket (${ev.code}${ev.reason ? `: ${ev.reason}` : ""}).`);
      stop();
    }
  };

  active = { stop };
  return { stop, utterances };
}

/** Stop whatever session is running. Safe to call when none is. */
export function stopThinkAloud() {
  active?.stop();
}
