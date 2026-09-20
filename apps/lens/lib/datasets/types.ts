/**
 * LENS Data Objectives — the registry's shape.
 * ─────────────────────────────────────────────────────────────────────
 *
 * A data objective is the same pedagogy as the gear train with the prop
 * swapped out: the student commits to a prediction, a real query runs
 * against real numbers, and the ladder in `lib/reasoning.ts` names the
 * belief behind a wrong answer without stating the fix.
 *
 * The dataset is the noise. The student is looking for the signal.
 *
 * Ladders live here rather than being improvised for the same reason the
 * demo objectives do — a judge who predicts "noon" should hear the same
 * well-aimed question every time. `lib/datasets/datasets.test.ts` holds
 * every rung below 4 to `lib/leak-check.ts`.
 *
 * No server imports: a client picker imports `listDatasets`. Anything
 * that touches the filesystem belongs in `lib/datasets/load.ts`.
 */

import type { DatasetRow } from "./csv";
import type { CuratedRung, Misconception } from "../lens/contracts";

/** A wrong prediction and the ladder that walks back from it. */
export type DatasetMisconception = Misconception;

export type DatasetQuestion = {
  /** Slug, unique within the dataset. */
  id: string;
  /** The question the student is reasoning about, in plain words. */
  prompt: string;
  /**
   * Asked BEFORE the query runs. A student who has committed to an answer
   * has committed to a belief, which is what makes the result informative
   * instead of just another number they watched appear.
   */
  predictionQuestion: string;
  /**
   * Computes the true answer from the slice. This is what actually runs
   * when a student submits a prediction.
   *
   * It is TypeScript rather than sandboxed Python for a blunt reason: the
   * public Piston runner that `lib/sandbox.ts` points at started returning
   * 401 on 2026-02-15 ("whitelist only"), so nothing that depends on it
   * executes any more. These snippets are repo-authored constants over a
   * committed CSV — a group-by and a mean — so there is nothing to isolate
   * and no reason to need a sandbox. Student-authored code is a different
   * question and must stay in the sandbox.
   */
  compute: (rows: DatasetRow[]) => string;
  /**
   * The same computation as standalone Python, so a judge can reproduce
   * the number themselves: pipe the committed CSV into it. Held to the
   * TypeScript result by `datasets.test.ts` whenever python3 is present,
   * which is what stops the two drifting apart.
   */
  reproduceWith: string;
  /**
   * Months (1–12) to send to the runner. The committed slice is a full
   * station-year; sending all 8,757 rows on stdin for a question that only
   * reasons about July wastes the payload budget. Omit to send all rows.
   */
  months?: number[];
  /** The misconceptions this question is built to expose. */
  misconceptions: DatasetMisconception[];
};

export type Dataset = {
  id: string;
  title: string;
  /** Where the data actually came from, for the write-up and the judges. */
  sourceUrl: string;
  /** How the committed slice was produced, precisely enough to redo it. */
  fetchNote: string;
  /** Path of the committed slice, relative to `apps/lens`. */
  csvPath: string;
  /**
   * What the data says that people confidently predict wrong. This is the
   * line that leads the Voloridge write-up, because "Insight" is scored.
   */
  insight: string;
  questions: DatasetQuestion[];
};

/** What `GET /api/datasets` returns — no ladders, nothing to leak. */
export type DatasetSummary = {
  id: string;
  title: string;
  sourceUrl: string;
  insight: string;
  questions: { id: string; prompt: string; predictionQuestion: string }[];
};

export const rung = (
  index: CuratedRung["rung"],
  reveals: CuratedRung["reveals"],
  text: string
): CuratedRung => ({ rung: index, reveals, text });
