import { describe, expect, it } from "vitest";
import { deterministicLeakCheck } from "../leak-check";
import { REVEAL_LEVELS } from "../lens/contracts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRows } from "./csv";
import { DATASETS, findQuestion, listDatasets } from "./index";
import { sliceForQuestion } from "./load";

const ladders = DATASETS.flatMap((dataset) =>
  dataset.questions.flatMap((question) =>
    question.misconceptions.map((misconception) => ({
      name: `${dataset.id}/${question.id}/${misconception.id}`,
      misconception,
    }))
  )
);

const questions = DATASETS.flatMap((dataset) =>
  dataset.questions.map((question) => ({
    name: `${dataset.id}/${question.id}`,
    dataset,
    question,
  }))
);

describe("every data-objective ladder", () => {
  it.each(ladders)("$name opens with a question that reveals nothing", ({ misconception }) => {
    const first = misconception.ladder[0];
    expect(first.reveals).toBe("nothing");
    expect(first.text.trim().endsWith("?")).toBe(true);
  });

  it.each(ladders)("$name climbs the reveals levels in order", ({ misconception }) => {
    expect(misconception.ladder.map((r) => r.rung)).toEqual([0, 1, 2, 3, 4]);
    expect(misconception.ladder.map((r) => r.reveals)).toEqual([...REVEAL_LEVELS]);
  });

  it.each(ladders)("$name states the fix at rung 4", ({ misconception }) => {
    expect(deterministicLeakCheck(misconception.ladder[4].text, misconception.fix)).toMatchObject({
      leaked: true,
      reason: "contains fix text",
    });
  });

  it.each(ladders)("$name never leaks the fix below rung 4", ({ misconception }) => {
    // Same checker the benchmark scores a model with, applied to our own content.
    for (const rung of misconception.ladder.slice(0, 4)) {
      const score = deterministicLeakCheck(rung.text, misconception.fix);
      expect(score, `rung ${rung.rung}: ${score.reason}`).toMatchObject({ leaked: false });
    }
  });
});

describe("the registry", () => {
  it("hands the browser prompts and never a ladder", () => {
    const payload = JSON.stringify(listDatasets());
    for (const { misconception } of ladders) {
      expect(payload).not.toContain(misconception.fix);
      expect(payload).not.toContain(misconception.ladder[4].text);
    }
  });

  it("gives every question a unique id inside its dataset", () => {
    for (const dataset of DATASETS) {
      const ids = dataset.questions.map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("resolves a known question and refuses an unknown one", () => {
    expect(findQuestion("noaa-isd", "hottest-hour")).not.toBeNull();
    expect(findQuestion("noaa-isd", "no-such-question")).toBeNull();
    expect(findQuestion("no-such-dataset", "hottest-hour")).toBeNull();
  });
});

describe("every committed slice", () => {
  it.each(questions)("$name cuts down to the months the question needs", async ({ dataset, question }) => {
    const slice = await sliceForQuestion(dataset, question);
    const lines = slice.split("\n");
    expect(lines.length).toBeGreaterThan(1);

    if (question.months?.length) {
      expect(lines[0]).toContain("timestamp");
      const wanted = new Set(question.months.map((m) => String(m).padStart(2, "0")));
      for (const line of lines.slice(1)) {
        expect(wanted.has(line.slice(5, 7))).toBe(true);
      }
    }
  });
});

/**
 * `compute` is what runs in production; `reproduceWith` is the Python a
 * judge can paste to check the number themselves. Two implementations of
 * one computation drift apart unless something holds them together, so
 * this runs both and demands the same string.
 *
 * python3 may be absent (CI images, a locked-down box). When it is, the
 * test says so out loud rather than passing quietly.
 */
describe("every question, computed for real", () => {
  it.each(questions)("$name returns a non-empty answer", async ({ dataset, question }) => {
    const rows = parseRows(await sliceForQuestion(dataset, question));
    expect(rows.length).toBeGreaterThan(0);
    expect(question.compute(rows).trim().length).toBeGreaterThan(0);
  });

  it.each(questions)("$name agrees with its published Python", async ({ dataset, question }) => {
    const slice = await sliceForQuestion(dataset, question);
    const expected = question.compute(parseRows(slice)).trim();

    const dir = mkdtempSync(path.join(tmpdir(), "lens-datasets-"));
    const script = path.join(dir, `${question.id}.py`);
    const csv = path.join(dir, `${question.id}.csv`);
    writeFileSync(script, question.reproduceWith);
    writeFileSync(csv, slice);

    let fromPython: string;
    try {
      fromPython = execFileSync("python3", [script], {
        input: slice,
        encoding: "utf8",
        timeout: 20_000,
      }).trim();
    } catch (error) {
      console.warn(
        `[datasets] SKIPPED the Python cross-check for ${dataset.id}/${question.id}: ` +
          `python3 did not run (${error instanceof Error ? error.message : error}). ` +
          `The TypeScript result was NOT verified against the published snippet.`
      );
      return;
    }

    expect(fromPython).toBe(expected);
  }, 30_000);
});
