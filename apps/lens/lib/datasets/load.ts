/**
 * Server-only: read a committed slice off disk and cut it down to the
 * rows a question actually reasons about.
 *
 * Kept out of `lib/datasets/index.ts` on purpose. The registry is imported
 * by client code; `node:fs` is not.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Dataset, DatasetQuestion } from "./types";

/**
 * The runner receives the slice on stdin, so the payload is the budget.
 * A full station-year is 376 KB; a single month is roughly a thirtieth of
 * that, which is why every question declares the months it needs.
 */
export async function sliceForQuestion(
  dataset: Dataset,
  question: DatasetQuestion
): Promise<string> {
  const absolute = path.join(process.cwd(), dataset.csvPath);
  const raw = await readFile(absolute, "utf8");
  const lines = raw.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return raw;

  const months = question.months;
  if (!months || months.length === 0) return lines.join("\n");

  const wanted = new Set(months.map((m) => String(m).padStart(2, "0")));
  const [header, ...body] = lines;
  const kept = body.filter((line) => wanted.has(line.slice(5, 7)));
  return [header, ...kept].join("\n");
}
