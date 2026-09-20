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
  /** What the model says it clicked, in its own words. Never a constant. */
  label: string;
  /**
   * One sentence describing what is actually on the captured screen. This
   * is the only account of the screen anything downstream gets — the voice
   * agent speaks from it — so it comes from the model, not from us.
   */
  observation: string;
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
  | "guide_step"
  /** set_mode — the tutor changed how it teaches (socratic/guided/explain). */
  | "mode_changed"
  /** note_understanding — the tutor's own read of how well they grasp it. */
  | "understanding_noted"
  /** note_misconception — a belief that keeps producing the same gap. */
  | "misconception_noted"
  /** The student named and kept this session. Carries the title. */
  | "session_saved"
  /** One flashcard graded: known / partial / unknown. */
  | "flashcard_reviewed"
  /** Kept to the library, or removed from it. */
  | "flashcard_saved"
  | "flashcard_unsaved"
  /** One quiz question answered, with whether it was right. */
  | "quiz_answered"
  | "quiz_saved"
  | "quiz_unsaved"
  /** One run of the reasoning pipeline, with its trace. */
  | "orchestrator_run"
  /** A video summary was rendered: frames, narration, optional stitch. */
  | "video_rendered"
  /** Token ledger: one provider call, with the usage it reported. */
  | "model_call"
  /** Token ledger: a provider call deliberately not made. */
  | "model_call_skipped";

/** Human label for an event. Typed chat is stored as a voice_turn with source "chat". */
export function eventLabel(e: { type: string; payload?: unknown }): string {
  if (e.type === "voice_turn" && (e.payload as any)?.source === "chat") return "chat message";
  return e.type.replace(/_/g, " ");
}

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

// ── Saved sessions ────────────────────────────────────────────────────
// A saved session is not a second copy of the session — it IS the event
// log, read back. Nothing below is stored as a snapshot, so a saved
// session can never drift from what actually happened. The only thing a
// save writes is the title, as one more event.

/** One row in the saved-sessions list. All counts are query results. */
export type SavedLiveSession = {
  sessionId: string;
  /** From the most recent `session_saved` event, else derived from the log. */
  title: string;
  /** True once the student has explicitly kept it. */
  saved: boolean;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  looks: number;
  voiceTurns: number;
  predictions: number;
  notes: number;
  misconceptions: number;
  /** Last recorded understanding level, 0–1. Null when never read. */
  finalUnderstanding: number | null;
};

/** A saved session reopened — enough to re-render the whole summary. */
export type LoadedLiveSession = SavedLiveSession & {
  transcript: { role: "user" | "agent"; text: string; at: number }[];
  understanding: { topic: string; level: number; why: string; at: number }[];
  beliefs: { belief: string; rootCause: string; practice: string; at: number }[];
  predictionTexts: { text: string; at: number }[];
  observations: { observation: string; confidence: number; at: number }[];
};

// ── Flashcards ────────────────────────────────────────────────────────
// Three grades, not two. A binary right/wrong forces "kind of" into one of
// the other buckets, and "kind of" is the single most useful signal a
// student gives you — it is the card they will fail next week.

export type CardGrade = "known" | "partial" | "unknown";

export const GRADE_LABEL: Record<CardGrade, string> = {
  known: "Got it",
  partial: "Kind of",
  unknown: "Not yet",
};

/** How many cards must pass before a graded card comes back around. */
export const REQUEUE_GAP: Record<CardGrade, number> = {
  known: 0, // graduated — does not come back this round
  partial: 4,
  unknown: 2,
};

export type Flashcard = {
  /** Deterministic hash of front+back, so the same card keeps its history. */
  id: string;
  front: string;
  back: string;
  /** Short concept label — what the end-of-deck report groups by. */
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  /** Which of the student's own sources this came from. */
  sourceTitle: string;
  /**
   * A sentence lifted verbatim from that source. Server-verified to
   * actually occur in the excerpt — an unverifiable quote is dropped
   * rather than shown, because a generated citation is worse than none.
   */
  sourceQuote: string | null;
};

/** A card in the library, with everything the event log knows about it. */
export type SavedFlashcard = Flashcard & {
  savedAt: string;
  reviews: number;
  /** Most recent grade, or null when never reviewed. */
  lastGrade: CardGrade | null;
  /** Times graded "unknown" or "partial". The struggle count. */
  missed: number;
};

// ── Quiz ──────────────────────────────────────────────────────────────
// Graded on the client on purpose: a quiz wants the answer to land the
// instant you commit to it, and a round trip per question makes it feel
// like a form. The ladder's UnderstandingCheck grades server-side because
// there the answer is withheld on purpose — different job, different rule.

export type QuizQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  /** Why the right answer is right. Shown after committing, never before. */
  explanation: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  sourceTitle: string;
  /** Verified verbatim against the excerpt, or null. Never generated. */
  sourceQuote: string | null;
};

export type SavedQuizQuestion = QuizQuestion & {
  savedAt: string;
  /** Times answered. */
  attempts: number;
  /** Times answered wrong. */
  wrong: number;
  lastCorrect: boolean | null;
};

/** What the study library can hold. */
export type LibraryKind = "card" | "question";

// ── Orchestration ─────────────────────────────────────────────────────
// The pipeline that decides what LENS says next. Four passes, and the
// first one is free — see lib/orchestrator.ts for why that ordering is
// the whole point rather than an optimisation.

export type TraceStepName =
  | "RECALL"
  | "GROUND"
  | "GATE"
  | "DIAGNOSE"
  | "VERIFY"
  | "INTERVENE";

export type TraceStep = {
  step: TraceStepName;
  /** Deterministic passes cost nothing and always run. */
  kind: "deterministic" | "model";
  ms: number;
  /** Model calls this step actually made. Zero for deterministic passes. */
  modelCalls: number;
  /** One line a human can read, shown in the trace panel. */
  summary: string;
  /** Set when the step was skipped, with the reason. */
  skipped?: string | null;
};

export type OrchestratorTrace = {
  sessionId: string;
  steps: TraceStep[];
  totalMs: number;
  modelCalls: number;
  /**
   * Model calls the gate avoided. This is a real count of skipped calls,
   * not an estimate — the gate either fired or it did not.
   */
  callsAvoided: number;
  /** The adversarial pass's verdict on the diagnosis. */
  verified: boolean | null;
  verifyNote?: string | null;
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
  /**
   * Model calls the pipeline's free RECALL pass made unnecessary, summed
   * from orchestrator traces. The same skips are also written to the token
   * ledger as `model_call_skipped`, so this and `modelCallsSkipped` are two
   * views of one event rather than two competing counters.
   */
  modelCallsAvoided: number;
  /** Diagnoses the adversarial VERIFY pass rejected before they were spoken. */
  diagnosesRejected: number;
  /** `model_call_skipped` rows — the ledger's view of the same skips. */
  modelCallsSkipped: number;
  /** Sum of tokensIn + tokensOut over `model_call` rows. */
  tokensSpent: number;
  /** Sum of `tokensSaved` over `model_call_skipped` rows. */
  tokensAvoided: number;
};

// ── Demo objectives (curated ladders for the physical props) ──────────
// The freeform engine improvises a ladder per call. For the objects that
// go on stage, the misconceptions are known in advance, so the ladder is
// authored once and served deterministically. Rung 0 is always a question.

/** What a rung gives away. Rung r reveals REVEAL_LEVELS[r]. */
export const REVEAL_LEVELS = [
  "nothing",
  "location",
  "cause",
  "strategy",
  "fix",
] as const;
export type RevealLevel = (typeof REVEAL_LEVELS)[number];

export type CuratedRung = {
  rung: 0 | 1 | 2 | 3 | 4;
  reveals: RevealLevel;
  /** The literal sentence LENS says. Rung 0 ends in a question mark. */
  text: string;
};

export type Misconception = {
  /** Slug, e.g. "gear_ratio_added". Doubles as the event `concept`. */
  id: string;
  /** Wrong predictions that reveal it, in the student's words. */
  wrongPredictions: string[];
  /** What the student currently believes, in their voice. */
  belief: string;
  /** The one specific idea that is wrong. */
  misconception: string;
  /**
   * The fix, stated plainly. Rung 4 contains it verbatim; rungs 0–3 are
   * checked against it with the benchmark's own leak checker.
   */
  fix: string;
  ladder: [CuratedRung, CuratedRung, CuratedRung, CuratedRung, CuratedRung];
};

export type DemoObjective = {
  id: string;
  title: string;
  /** The objective text the client sends with a frame or a reasoning call. */
  objective: string;
  /** Lower-case words that must all appear for a free-text objective to match. */
  keywords: string[];
  /** What the vision prompt should look for on this object. */
  lookFor: string;
  misconceptions: Misconception[];
  /**
   * The one question to put to whoever is holding the object before they
   * touch it. Their pick is recorded as a `prediction` event, so a wrong
   * one lands on the curated ladder exactly as a spoken prediction would.
   * A judge who picks the popular wrong answer is now the student.
   */
  entryCheck?: EntryCheck;
};

export type EntryCheck = {
  question: string;
  /** Each option must match one of a misconception's wrongPredictions, or be right. */
  options: string[];
  correctIndex: number;
};

/** What `GET /api/objectives` returns — no ladders, nothing to leak. */
export type DemoObjectiveSummary = Pick<DemoObjective, "id" | "title" | "objective">;

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

// ── Concept map (built from the student's conversation) ───────────────

export const RELATIONS = ["part of", "needs", "example of", "different from", "leads to"] as const;
export type Relation = (typeof RELATIONS)[number];
/** Hierarchy relations: a node's link to its ONE parent (the tree backbone). */
export const PARENT_RELATIONS = ["part of", "type of", "step of"] as const;
export type ParentRelation = (typeof PARENT_RELATIONS)[number];
/** Non-hierarchical cross-links, drawn dashed. */
export const CROSS_RELATIONS = ["needs", "different from", "leads to", "example of"] as const;
export type ConceptStatus = "mentioned" | "shaky" | "solid";

/** Where a node or edge came from. Quotes are verbatim, checked server-side. */
export type Evidence =
  | { kind: "student"; eventId: string; quote: string }
  /** Something the tutor said. It can introduce a topic, never set a status. */
  | { kind: "tutor"; eventId: string; quote: string }
  | { kind: "note"; sourceId: string; title: string; quote: string };

/** An answer taken from the student's own notes; the quote is verbatim in the source. */
/**
 * Why a node sits under its parent. "quote": one verbatim quote names both.
 * "notes-structure": both appear in the same note passage or heading.
 * "conversation": they came up in the same exchange. Only "quote" is a
 * verified statement of the relation; the UI draws the others dotted.
 */
export type ParentBasis = "quote" | "notes-structure" | "conversation";

export type NodeAnswer = { text: string; quote: string; sourceId: string; title: string };

export type ConceptNode = {
  id: string;
  name: string;
  status: ConceptStatus;
  evidence: Evidence[];
  /** The one parent (tree backbone). Absent = root, or a loose idea. */
  parentId?: string;
  parentRelation?: ParentRelation;
  /** Verbatim quote(s) that mention both this concept and its parent. */
  parentEvidence?: Evidence[];
  parentBasis?: ParentBasis;
  /** False when no note passage covers the topic (it was only discussed). */
  inNotes?: boolean;
  /** Answer to reviewQuestion from the notes. Absent = the notes don't answer it. */
  answer?: NodeAnswer;
  /** A question to revise this concept; written not to give the answer. */
  reviewQuestion?: string | null;
  addedAt: string;
};

export type ConceptEdge = {
  id: string;
  from: string;
  to: string;
  label: Relation;
  evidence: Evidence[];
  addedAt: string;
};

export type ConceptMap = {
  sessionId: string;
  userId?: string;
  updatedAt: string;
  /** Student turns already folded into the map (server-side bookkeeping). */
  processedEventIds?: string[];
  /** Failed fold-in attempts per turn; a turn is dropped after a bounded number. */
  attempts?: Record<string, number>;
  /** The main subject (validated). Absent until one qualifies; nodes show as loose ideas. */
  rootId?: string;
  /** What the latest update added — the UI highlights these. */
  lastAdded: { nodes: string[]; edges: string[] };
  nodes: ConceptNode[];
  edges: ConceptEdge[];
};
