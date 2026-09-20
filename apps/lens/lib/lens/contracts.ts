/**
 * LENS — Shared type contracts.
 * ─────────────────────────────────────────────────────────────────────
 * THIS FILE IS THE TEAM CONTRACT. Agree on it in hour 0, then build
 * against it in parallel. Person 1 (frontend) codes against these types
 * before Person 2/3 have working endpoints; Person 2/3 return exactly
 * these shapes. Nothing here depends on a provider SDK, so it is safe to
 * import from both client components and route handlers.
 *
 * Rule that governs every field below: it is filled by a real model call
 * on real captured input, or a real deterministic computation. No
 * fixture, no fallback string, no "demo mode" value. See ENGINEERING.md.
 */

// ── The hint ladder — one pedagogy for the whole product ──────────────
// L0 observe · L1 point · L2 ask · L3 nudge · L4 experiment · L5 explain
export const HINT_LADDER = [
  "OBSERVE",
  "POINT",
  "ASK",
  "NUDGE",
  "EXPERIMENT",
  "EXPLAIN",
] as const;
export type HintLevel = (typeof HINT_LADDER)[number];

/** Level index — used for "escalation depth" instrumentation. */
export function hintLevelIndex(level: HintLevel): number {
  return HINT_LADDER.indexOf(level);
}

// ── Vision (Person 2 → Person 1) ──────────────────────────────────────

/** Normalized 0–1 box, origin top-left. Scale by rendered video size. */
export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisionObservation = {
  /** One sentence describing what is actually in the frame. */
  observation: string;
  /** Objects the model identified, most relevant first. */
  objects: string[];
  /** Where to point. Null when nothing specific is worth pointing at. */
  boundingBox: BoundingBox | null;
  /** Model's own confidence, 0–1. Surfaced in the UI as "likely", never "certain". */
  confidence: number;
  /** Machine-readable misconception slug, e.g. "led_polarity". */
  possibleIssue?: string | null;
  /** The question LENS asks INSTEAD of explaining. */
  suggestedQuestion?: string | null;
  /** 2–4 options for that question. */
  suggestedOptions?: string[];
  /**
   * Always false in the demo path. If a model ever sets this true it is
   * counted in the metrics strip as a direct answer — the one number we
   * claim stays at zero.
   */
  shouldRevealAnswer: boolean;
};

// ── Reasoning (Person 2 → Person 1) ───────────────────────────────────

export type NextAction =
  | "POINT"
  | "ASK"
  | "NUDGE"
  | "EXPERIMENT"
  | "UNDERSTANDING_CHECK"
  | "NEXT_STEP";

export type UnderstandingCheck = {
  question: string;
  options: string[];
  /** Index into options. Graded server-side; never sent before answering. */
  correctIndex: number;
  /** Shown after the student answers — why, not just what. */
  rationale: string;
};

/** A passage from the student's own notes. `quote` is copied verbatim, never generated. */
export type Citation = {
  title: string;
  quote: string;
  sourceId: string;
  /** The passage conflicts with what the student did or believes. */
  contradicts?: boolean;
};

export type ReasoningState = {
  _id?: string;
  sessionId: string;
  /** What the student is trying to accomplish right now. */
  objective: string;
  /** What LENS thinks the student currently believes. */
  probableBelief?: string | null;
  /** The specific point where reasoning diverged from the material. */
  misconception?: string | null;
  confidence: number;
  /** Human-readable, each line traceable to a real event id. */
  evidence: string[];
  nextAction: NextAction;
  /** The smallest next nudge — a question or instruction, never an answer. */
  intervention?: string | null;
  hintLevel: HintLevel;
  understandingCheck?: UnderstandingCheck | null;
  /** True when there is not yet enough real evidence to infer anything. */
  insufficientEvidence?: boolean;
  /** Passages from the student's active, in-session notes the reasoning drew on. */
  citations?: Citation[];
  createdAt?: string;
};

// ── Pointer (Person 3 → Person 1) ─────────────────────────────────────

export type PointerTarget = {
  /** Pixel coordinates in the ORIGINAL captured image's coordinate space. */
  x: number;
  y: number;
  /** Same point as a 0–1 fraction — use this for CSS positioning. */
  nx: number;
  ny: number;
  label: string;
  /** Resolution actually declared to Computer Use, for debugging. */
  declared: { width: number; height: number };
};

// ── Guide (screen walkthrough, Chrome extension) ──────────────────────
/**
 * Guide mode is the one place LENS deliberately hands something over, and
 * the split is the whole reason it is allowed to.
 *
 *   `step` is NAVIGATION — "click Launch instance". Nobody learns anything
 *   by hunting for where a console hid a button, so withholding it is
 *   friction without pedagogy. This is the only string in the product that
 *   may be an instruction.
 *
 *   `why` is UNDERSTANDING — and it stays a QUESTION. The moment it answers
 *   itself, the ladder is broken and `directAnswersGiven` should tick.
 *
 * Anything that is genuinely conceptual still belongs on HINT_LADDER.
 */
export type GuideStatus =
  /** The screen is where the previous step should have landed them. */
  | "on_track"
  /** They are somewhere the goal does not pass through. */
  | "off_track"
  /** Nothing on this screen can advance the goal (wrong account, an error). */
  | "blocked"
  /** The goal is visibly accomplished on this screen. */
  | "done";

export type GuideStep = {
  /** One imperative sentence naming the control by its visible label. */
  step: string;
  /** A question about why this step matters. Never its answer. */
  why: string | null;
  status: GuideStatus;
  /** Where the control is. Null when done, blocked, or nothing to point at. */
  target: PointerTarget | null;
  /** Model's read of the current screen, one sentence. Shown as context. */
  observation: string;
  /** Monotonic index within a single goal, assigned client-side. */
  index: number;
};

// ── Learning events (Person 4 owns the collection) ────────────────────

export type LensEventType =
  | "prediction"
  | "camera_frame_analyzed"
  | "pointer_used"
  | "hint_requested"
  | "understanding_check_answered"
  | "experiment_started"
  | "experiment_completed"
  | "retry"
  | "source_opened"
  | "voice_turn"
  | "guide_step";

export type LensEvent = {
  _id?: string;
  sessionId: string;
  userId?: string;
  type: LensEventType;
  /** Concept slug this event is about, e.g. "led_polarity". */
  concept?: string | null;
  payload: Record<string, unknown>;
  timestamp: string;
};

// ── Experiments (P1 — Proof tier) ─────────────────────────────────────

export type Experiment = {
  _id?: string;
  sessionId: string;
  concept: string;
  hypothesis: string;
  steps: string[];
  predictionQuestion: string;
  reflectionQuestion: string;
  status: "pending" | "predicted" | "completed";
  studentPrediction?: string | null;
  actualOutcome?: string | null;
  createdAt?: string;
  completedAt?: string | null;
};

// ── Metrics strip (Person 4) ──────────────────────────────────────────

export type LensMetrics = {
  /** The thesis number. Must read 0 for the whole demo. */
  directAnswersGiven: number;
  hintsIssued: number;
  deepestHintLevel: HintLevel | null;
  understandingChecksAsked: number;
  understandingChecksCorrect: number;
  misconceptionsDetected: number;
  misconceptionsResolved: number;
  experimentsRun: number;
  voiceTurns: number;
  visionCalls: number;
  visionLatencyMsP50: number | null;
  visionLatencyMsP95: number | null;
};

// ── Camera state machine (Section 11 of the PDR) ──────────────────────

export type CameraState =
  | "IDLE"
  | "OBSERVE"
  | "IDENTIFY_NEXT_STEP"
  | "POINT"
  | "ASK"
  | "WAIT_FOR_STUDENT"
  | "VERIFY"
  | "UPDATE_STUDENT_MODEL"
  | "NEXT_STEP";

export const CAMERA_STATE_LABEL: Record<CameraState, string> = {
  IDLE: "Ready",
  OBSERVE: "Looking",
  IDENTIFY_NEXT_STEP: "Thinking",
  POINT: "Pointing",
  ASK: "Asking",
  WAIT_FOR_STUDENT: "Your turn",
  VERIFY: "Checking your change",
  UPDATE_STUDENT_MODEL: "Updating what I know",
  NEXT_STEP: "Next step",
};
