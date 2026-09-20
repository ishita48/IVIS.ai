/**
 * LENS Demo Objectives — curated ladders for the props that go on stage.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The reasoning engine improvises a ladder per call. That is right for an
 * arbitrary workspace and wrong for the gear train: a judge who predicts
 * "3×" should hear the same well-aimed question every time, not whatever
 * the model came up with this run. So for the demo objects the
 * misconceptions are written down here, each with the wrong predictions
 * that reveal it and a five-rung ladder authored to the `reveals` levels.
 *
 * `lib/reasoning.ts` consults this registry before it calls a model. When
 * the active objective matches an entry and the student's latest
 * prediction matches a known wrong answer, the curated ladder is served
 * and the model is not woken. The hint cap is unchanged: the rung that
 * ships is the highest one the session has unlocked.
 *
 * `lib/objectives.test.ts` holds every rung below 4 to the benchmark's own
 * leak checker. Edit a rung, run `npm test`.
 *
 * No server imports. A client picker may import `listObjectives`.
 */

import {
  HINT_LADDER,
  type CuratedRung,
  type DemoObjective,
  type DemoObjectiveSummary,
  type HintLevel,
  type LensEvent,
  type Misconception,
  type NextAction,
} from "./lens/contracts";
import { DATASETS, objectiveTextFor } from "./datasets";

const rung = (
  index: CuratedRung["rung"],
  reveals: CuratedRung["reveals"],
  text: string
): CuratedRung => ({ rung: index, reveals, text });

export const DEMO_OBJECTIVES: DemoObjective[] = [
  {
    id: "gear-train",
    title: "Compound gear train",
    objective:
      "Predict how many times the output gear turns per crank turn, and which way, on the printed two-stage gear train.",
    keywords: ["gear"],
    lookFor:
      "A printed compound gear train on a spine with three pegs: a 30-tooth crank gear, a middle peg carrying a 10-tooth and a 30-tooth wheel stacked on one part, and a 10-tooth output gear. Box the middle peg when the student's hand is on the crank; note which way the crank and output are turning if visible.",
    misconceptions: [
      {
        id: "gear_ratio_added",
        wrongPredictions: ["3x", "6x", "3", "6", "triple", "double"],
        belief:
          "Each stage is 3 to 1, so two stages is 3 to 1 or maybe 6 to 1. You add them up.",
        misconception: "Gear stages in series add their ratios.",
        fix: "The two 3:1 stages multiply, so the output turns nine times per crank turn.",
        ladder: [
          rung(
            0,
            "nothing",
            "Before you crank it: how many places on this train do teeth actually mesh with other teeth?"
          ),
          rung(
            1,
            "location",
            "Look at the middle peg: how many gear wheels does that one part carry, and does the motion pass through both of them on its way to the output?"
          ),
          rung(
            2,
            "cause",
            "Each mesh applies its own ratio to whatever speed arrives at it, and the second mesh is working on a speed the first mesh already sped up."
          ),
          rung(
            3,
            "strategy",
            "Put a mark on the output gear and one on the crank, turn the crank one full revolution slowly, and count how many times the output mark comes around."
          ),
          rung(
            4,
            "fix",
            "The two 3:1 stages multiply, so the output turns nine times per crank turn: 30 over 10 at the first mesh, times 30 over 10 at the second."
          ),
        ],
      },
      {
        id: "gear_direction_reversed",
        wrongPredictions: [
          "reverses",
          "reverse",
          "reversed",
          "opposite",
          "opposite direction",
          "opposite way",
          "backwards",
          "backward",
          "other way",
          "the other way",
          "flips",
        ],
        belief: "Gears reverse things, so the output turns against the crank.",
        misconception:
          "A gear train reverses direction regardless of how many meshes it has.",
        fix: "Each mesh reverses direction, and two reversals cancel, so the output turns the same way as the crank.",
        ladder: [
          rung(
            0,
            "nothing",
            "Watch just the crank gear and the wheel it touches: which way does each of them turn?"
          ),
          rung(
            1,
            "location",
            "There are two places where teeth meet on this train, not one. Can you find the second, between the middle peg's big wheel and the output?"
          ),
          rung(
            2,
            "cause",
            "A mesh does one thing to direction every time it happens, and this train does it twice before the motion reaches the output."
          ),
          rung(
            3,
            "strategy",
            "Turn the crank a quarter turn and freeze. Note which way the middle peg moved, then do the same from the middle peg to the output."
          ),
          rung(
            4,
            "fix",
            "Each mesh reverses direction, and two reversals cancel, so the output turns the same way as the crank."
          ),
        ],
      },
    ],
  },
  {
    id: "solder-led",
    title: "Solder an LED to the board",
    objective:
      "Place the LED on the protoboard and solder it in so that it lights when power is applied.",
    keywords: ["solder", "led"],
    lookFor:
      "A protoboard with copper row strips, an LED with two legs of different lengths and a flat edge on its lens, a soldering iron and solder. Box the LED's two legs where they enter the board; note whether both legs share one copper strip and which leg is longer.",
    misconceptions: [
      {
        id: "led_polarity_ignored",
        wrongPredictions: [
          "either",
          "either way",
          "either pad",
          "doesnt matter",
          "does not matter",
          "any way",
          "both ways",
          "no difference",
          "round pad",
          "the round pad",
        ],
        belief: "An LED is a little bulb. It lights whichever way round it goes in.",
        misconception: "LED orientation does not affect whether it lights.",
        fix: "The longer leg is the anode and goes to the pad marked plus, so the LED only conducts one way.",
        ladder: [
          rung(
            0,
            "nothing",
            "Look at the two legs of the LED before it goes in: are they the same length?"
          ),
          rung(
            1,
            "location",
            "The clue is on the board, not the part. Look at the outline printed around the two pads for this LED: what is different about one side of it?"
          ),
          rung(
            2,
            "cause",
            "This component only passes current in one direction, and the leg lengths and the flat edge on the lens exist so you can tell which direction that is."
          ),
          rung(
            3,
            "strategy",
            "Hold the LED against a coin cell both ways round before you solder anything, and watch what happens each time."
          ),
          rung(
            4,
            "fix",
            "The longer leg is the anode and goes to the pad marked plus, so the LED only conducts one way. Flip it and it stays dark."
          ),
        ],
      },
      {
        id: "led_legs_same_row",
        wrongPredictions: [
          "same row",
          "the same row",
          "one row",
          "any row",
          "next to each other",
          "side by side",
        ],
        belief: "Both legs in one row is fine. They are both soldered to the board.",
        misconception: "Two holes in the same copper row are two separate connections.",
        fix: "Every hole in a row is one connection, so the two legs must sit in different rows or the LED is shorted.",
        ladder: [
          rung(
            0,
            "nothing",
            "Turn the board over: which holes on the back are joined by one piece of copper?"
          ),
          rung(
            1,
            "location",
            "Look at where both legs of the LED come through, then follow the copper on the back from one leg: does it reach the other?"
          ),
          rung(
            2,
            "cause",
            "A copper strip is one electrical point along its whole length, however many holes it has."
          ),
          rung(
            3,
            "strategy",
            "Before you solder, put the meter on continuity and touch both LED legs at once. Then move one leg over and try again."
          ),
          rung(
            4,
            "fix",
            "Every hole in a row is one connection, so the two legs must sit in different rows or the LED is shorted. Move one leg so the two land on separate strips."
          ),
        ],
      },
    ],
  },
  {
    id: "percent-discount",
    title: "Undo a percent discount",
    objective:
      "A shirt costs $80 after a 20% discount. Find the original price.",
    keywords: ["discount"],
    lookFor:
      "Handwritten or typed arithmetic on paper or a tablet: a starting figure of 80, a percentage of 20, and the student's working toward an original price. Box the line where 20% is taken of a number, and read which number it was taken of.",
    misconceptions: [
      {
        id: "percent_added_back",
        wrongPredictions: ["96", "$96", "96 dollars"],
        belief: "Taking 20% off and adding 20% back undo each other, so 80 plus 20% of 80 is the original.",
        misconception: "A percent increase undoes the same percent decrease.",
        fix: "80 is 80% of the original, so the original is 80 divided by 0.8, which is 100.",
        ladder: [
          rung(
            0,
            "nothing",
            "The 20% was taken off some number. Which number was it a percent of: the price before, or the price after?"
          ),
          rung(
            1,
            "location",
            "Look at the step where you took 20% of 80. Is 80 the starting point of the discount, or its result?"
          ),
          rung(
            2,
            "cause",
            "A percent is always a fraction of a specific base, and the discount and your reversal of it are not built on the same base."
          ),
          rung(
            3,
            "strategy",
            "Check your candidate: take 20% off 96 and see whether you land back on 80. Then try the same check on a different guess."
          ),
          rung(
            4,
            "fix",
            "80 is 80% of the original, so the original is 80 divided by 0.8, which is 100. Twenty percent off leaves 80%, and undoing it means dividing by 0.8, not adding 20% back."
          ),
        ],
      },
      {
        id: "percent_applied_again",
        wrongPredictions: ["64", "$64", "64 dollars"],
        belief: "To get back to where it started, do the same thing again: 80 times 0.8.",
        misconception: "Undoing a discount is applying the discount a second time.",
        fix: "The original is larger than 80, so multiplying by 0.8 again goes the wrong way; divide 80 by 0.8 to get 100.",
        ladder: [
          rung(
            0,
            "nothing",
            "Before the discount, was the shirt cheaper or more expensive than it is now?"
          ),
          rung(
            1,
            "location",
            "Look at the direction of your last step: you started at 80. Did your answer come out above it or below it?"
          ),
          rung(
            2,
            "cause",
            "A discount and its undo are opposite operations, and doing the same one twice moves you further in the same direction."
          ),
          rung(
            3,
            "strategy",
            "Take your answer of 64 and apply the 20% discount to it. Does it come back to 80?"
          ),
          rung(
            4,
            "fix",
            "The original is larger than 80, so multiplying by 0.8 again goes the wrong way; divide 80 by 0.8 to get 100."
          ),
        ],
      },
    ],
  },
];

// ── Lookup ────────────────────────────────────────────────────────────

/** What `GET /api/objectives` returns. Ladders never leave the server this way. */
export function listObjectives(): DemoObjectiveSummary[] {
  return DEMO_OBJECTIVES.map(({ id, title, objective }) => ({ id, title, objective }));
}

function normalizeObjective(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9%$]+/g, " ").trim();
}

/**
 * The registry entry for an objective string, or null. Matches the id, the
 * title, the exact objective text, or free text containing every keyword.
 */
export function findObjective(text?: string | null): DemoObjective | null {
  if (!text) return null;
  const norm = normalizeObjective(text);
  if (!norm) return null;
  for (const entry of DEMO_OBJECTIVES) {
    if (
      norm === entry.id ||
      norm === normalizeObjective(entry.title) ||
      norm === normalizeObjective(entry.objective)
    ) {
      return entry;
    }
  }
  const words = new Set(norm.split(" "));
  for (const entry of DEMO_OBJECTIVES) {
    if (entry.keywords.every((k) => words.has(k))) return entry;
  }
  return null;
}

/**
 * The `lookFor` note for the vision prompt, or null when the objective is
 * not a demo object. `lib/vision.ts` does not read this yet.
 */
export function lookForObjective(text?: string | null): string | null {
  return findObjective(text)?.lookFor ?? null;
}

// ── Prediction matching ───────────────────────────────────────────────

const NUMBER_WORDS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  twelve: "12",
};

/**
 * "3×", "3 times", "three times" and "3x" are the same prediction. Case,
 * punctuation and currency symbols are not part of what a student meant.
 */
export function normalizePrediction(text: string): string {
  let t = String(text ?? "")
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/[$'’]/g, "")
    .replace(/[^a-z0-9%\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  t = t
    .split(" ")
    .map((w) => NUMBER_WORDS[w] ?? w)
    .join(" ");
  t = t.replace(/\b(\d+)\s*(?:x|times)\b/g, "$1x");
  return t;
}

export function predictionMatches(prediction: string, wrongPredictions: string[]): boolean {
  const norm = normalizePrediction(prediction);
  if (!norm) return false;
  const padded = ` ${norm} `;
  return wrongPredictions.some((p) => {
    const wp = normalizePrediction(p);
    return wp.length > 0 && padded.includes(` ${wp} `);
  });
}

/** First misconception whose wrong predictions the student's answer matches. */
export function matchMisconception(
  objective: DemoObjective,
  prediction: string
): Misconception | null {
  return (
    objective.misconceptions.find((m) => predictionMatches(prediction, m.wrongPredictions)) ??
    null
  );
}

/** The student's most recent recorded prediction, as text. */
export function latestPrediction(events: LensEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== "prediction") continue;
    const p = e.payload as { answer?: unknown; value?: unknown; prediction?: unknown };
    const text = p.answer ?? p.value ?? p.prediction;
    if (typeof text === "string" && text.trim()) return text;
    if (typeof text === "number") return String(text);
  }
  return null;
}

export type CuratedMatch = {
  objective: DemoObjective;
  misconception: Misconception;
  /** The prediction that matched, verbatim, for the evidence line. */
  prediction: string;
  /** 1-based index of the matching prediction event in `events`. */
  eventIndex: number;
};

/**
 * The curated ladder to serve for this objective and event log, or null
 * when the engine should improvise as usual.
 */
function predictionEventIndex(events: LensEvent[]): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === "prediction") return i + 1;
  }
  return 0;
}

/**
 * Same shape as a demo objective for the curated path — dataset questions
 * already carry Misconception ladders, so the engine can serve them without
 * waking a model.
 */
function datasetAsDemo(
  datasetId: string,
  questionPrompt: string,
  misconceptions: Misconception[]
): DemoObjective {
  return {
    id: datasetId,
    title: datasetId,
    objective: questionPrompt,
    keywords: [],
    lookFor: "",
    misconceptions,
  };
}

export function curatedLadderFor(
  objectiveText: string | undefined | null,
  events: LensEvent[]
): CuratedMatch | null {
  const prediction = latestPrediction(events);
  if (!prediction) return null;
  const eventIndex = predictionEventIndex(events);

  const objective = findObjective(objectiveText);
  if (objective) {
    const misconception = matchMisconception(objective, prediction);
    if (misconception) return { objective, misconception, prediction, eventIndex };
  }

  const norm = (objectiveText || "").trim();
  if (!norm) return null;
  for (const dataset of DATASETS) {
    for (const question of dataset.questions) {
      if (objectiveTextFor(dataset, question) !== norm && question.prompt !== norm) {
        continue;
      }
      const asDemo = datasetAsDemo(
        `${dataset.id}:${question.id}`,
        objectiveTextFor(dataset, question),
        question.misconceptions
      );
      const misconception = matchMisconception(asDemo, prediction);
      if (!misconception) return null;
      return { objective: asDemo, misconception, prediction, eventIndex };
    }
  }
  return null;
}

// ── Rungs and the hint ladder ─────────────────────────────────────────
// Rung r sits at HINT_LADDER[r + 1]: OBSERVE says nothing, so the five
// rungs occupy POINT through EXPLAIN. Rung 0 points with a question that
// reveals nothing; rung 1 asks about the location. The session's cap from
// `nextAllowedLevel` decides the highest rung that may ship.

export function rungLevel(index: CuratedRung["rung"]): HintLevel {
  return HINT_LADDER[index + 1];
}

const RUNG_ACTION: Record<CuratedRung["rung"], NextAction> = {
  0: "POINT",
  1: "ASK",
  2: "NUDGE",
  3: "EXPERIMENT",
  4: "NEXT_STEP",
};

export function rungAction(index: CuratedRung["rung"]): NextAction {
  return RUNG_ACTION[index];
}

/** The highest rung unlocked at this cap, or null when nothing may be said. */
export function unlockedRung(
  misconception: Misconception,
  cap: HintLevel
): CuratedRung | null {
  const index = Math.min(HINT_LADDER.indexOf(cap) - 1, 4);
  if (index < 0) return null;
  return misconception.ladder[index];
}
