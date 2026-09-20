/**
 * The data-objective registry.
 *
 * Pure data — no filesystem, no database, no model. A client picker may
 * import `listDatasets` and `findQuestion`; `lib/server-boundary.test.ts`
 * enforces that this stays true.
 *
 * Adding a dataset: write it in its own file, append it to DATASETS, and
 * run `npm test`. The registry test will refuse a ladder whose lower
 * rungs give the answer away.
 */

import { NOAA_ISD } from "./noaa-isd";
import type { Dataset, DatasetQuestion, DatasetSummary } from "./types";

export * from "./types";

export const DATASETS: Dataset[] = [NOAA_ISD];

/** Safe to hand a browser: prompts and insights, no ladders. */
export function listDatasets(): DatasetSummary[] {
  return DATASETS.map((dataset) => ({
    id: dataset.id,
    title: dataset.title,
    sourceUrl: dataset.sourceUrl,
    insight: dataset.insight,
    questions: dataset.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      predictionQuestion: question.predictionQuestion,
    })),
  }));
}

export function findDataset(datasetId: string): Dataset | null {
  return DATASETS.find((dataset) => dataset.id === datasetId) ?? null;
}

export function findQuestion(
  datasetId: string,
  questionId: string
): { dataset: Dataset; question: DatasetQuestion } | null {
  const dataset = findDataset(datasetId);
  if (!dataset) return null;
  const question = dataset.questions.find((q) => q.id === questionId);
  return question ? { dataset, question } : null;
}

/**
 * The objective text handed to `analyzeReasoning`. It names the question
 * and never the answer — the ladder is what decides how much to give.
 */
export function objectiveTextFor(
  dataset: Dataset,
  question: DatasetQuestion
): string {
  return `${question.prompt} (dataset: ${dataset.title})`;
}
