import { describe, expect, it } from "vitest";
import { deterministicLeakCheck } from "./leak-check";
import {
  DEMO_OBJECTIVES,
  curatedLadderFor,
  findObjective,
  listObjectives,
  normalizePrediction,
  predictionMatches,
  rungLevel,
  unlockedRung,
} from "./objectives";
import { REVEAL_LEVELS, type LensEvent } from "./lens/contracts";

const cases = DEMO_OBJECTIVES.flatMap((objective) =>
  objective.misconceptions.map((misconception) => ({
    name: `${objective.id}/${misconception.id}`,
    misconception,
  }))
);

describe("every curated ladder", () => {
  it.each(cases)("$name opens with a question that reveals nothing", ({ misconception }) => {
    // The first thing LENS says on stage is a question, never a statement about the mistake.
    const first = misconception.ladder[0];
    expect(first.reveals).toBe("nothing");
    expect(first.text.trim().endsWith("?")).toBe(true);
  });

  it.each(cases)("$name climbs the reveals levels in order", ({ misconception }) => {
    // Rung r reveals REVEAL_LEVELS[r], so the client can trust the level without reading the text.
    expect(misconception.ladder.map((r) => r.rung)).toEqual([0, 1, 2, 3, 4]);
    expect(misconception.ladder.map((r) => r.reveals)).toEqual([...REVEAL_LEVELS]);
  });

  it.each(cases)("$name states the fix at rung 4", ({ misconception }) => {
    // The top rung is the one place the answer is allowed, and it has to actually be there.
    expect(deterministicLeakCheck(misconception.ladder[4].text, misconception.fix)).toMatchObject({
      leaked: true,
      reason: "contains fix text",
    });
  });

  it.each(cases)("$name never leaks the fix below rung 4", ({ misconception }) => {
    // The product's thesis, applied to its own demo content, by the checker the benchmark uses.
    for (const rung of misconception.ladder.slice(0, 4)) {
      const score = deterministicLeakCheck(rung.text, misconception.fix);
      expect(score, `rung ${rung.rung}: ${score.reason}`).toMatchObject({ leaked: false });
    }
  });

  it.each(cases)("$name has at least one wrong prediction that matches itself", ({ misconception }) => {
    // A misconception nobody can trigger is dead content.
    expect(misconception.wrongPredictions.length).toBeGreaterThan(0);
    for (const wrong of misconception.wrongPredictions) {
      expect(predictionMatches(wrong, misconception.wrongPredictions)).toBe(true);
    }
  });
});

describe("the gear train", () => {
  const gear = findObjective("gear-train")!;

  it.each(["3×", "3x", "3 times", "three times", "6x", "six", "3 to 1"])(
    "reads %s as the added-ratio misconception",
    (prediction) => {
      // Nearly every judge says 3× or 6×; those words must land on the same rung every time.
      expect(gear.misconceptions.find((m) => predictionMatches(prediction, m.wrongPredictions))?.id).toBe(
        "gear_ratio_added"
      );
    }
  );

  it.each(["it reverses", "the opposite direction", "backwards", "the other way"])(
    "reads %s as the reversed-direction misconception",
    (prediction) => {
      // Two meshes cancel, so a "reverses" prediction is the second thing the prop is built to catch.
      expect(gear.misconceptions.find((m) => predictionMatches(prediction, m.wrongPredictions))?.id).toBe(
        "gear_direction_reversed"
      );
    }
  );

  it("leaves a correct prediction to the freeform engine", () => {
    // Nine times, same way is right, and there is no curated ladder for being right.
    expect(gear.misconceptions.some((m) => predictionMatches("9x, same way as the crank", m.wrongPredictions))).toBe(
      false
    );
  });
});

describe("findObjective", () => {
  it("matches the id, the title, the objective text, and free text with the keywords", () => {
    // The voice agent and the objective box both send free text; all of it has to land on the same entry.
    const gear = DEMO_OBJECTIVES[0];
    expect(findObjective("gear-train")?.id).toBe(gear.id);
    expect(findObjective(gear.title)?.id).toBe(gear.id);
    expect(findObjective(gear.objective)?.id).toBe(gear.id);
    expect(findObjective("How fast does the output GEAR spin?")?.id).toBe(gear.id);
    expect(findObjective("Solder the LED without bridging pads")?.id).toBe("solder-led");
    expect(findObjective("the discount problem on the worksheet")?.id).toBe("percent-discount");
  });

  it("returns null for anything else", () => {
    // An unknown objective means the model improvises, as it always has.
    expect(findObjective("wire the breadboard")).toBeNull();
    expect(findObjective("")).toBeNull();
    expect(findObjective(undefined)).toBeNull();
  });
});

describe("normalizePrediction", () => {
  it("treats ×, x, times and number words as the same prediction", () => {
    // Students say the same thing five ways; the registry should not need five entries.
    expect(normalizePrediction("3×")).toBe("3x");
    expect(normalizePrediction("Three TIMES")).toBe("3x");
    expect(normalizePrediction("$96")).toBe("96");
  });
});

function event(type: LensEvent["type"], payload: Record<string, unknown>): LensEvent {
  return { sessionId: "s", type, payload, timestamp: new Date().toISOString() };
}

describe("curatedLadderFor", () => {
  const frame = event("camera_frame_analyzed", { observation: "gear train on the desk" });

  it("serves the gear ladder when the latest prediction is a known wrong one", () => {
    // This is the demo: objective plus wrong prediction, and the engine does not need a model.
    const match = curatedLadderFor("gear-train", [frame, event("prediction", { answer: "3×" })]);
    expect(match?.misconception.id).toBe("gear_ratio_added");
    expect(match?.prediction).toBe("3×");
    expect(match?.eventIndex).toBe(2);
  });

  it("uses the most recent prediction, not the first", () => {
    // A student who revises their answer should be met where they are now.
    const match = curatedLadderFor("gear-train", [
      frame,
      event("prediction", { answer: "3x" }),
      event("prediction", { value: "it reverses" }),
    ]);
    expect(match?.misconception.id).toBe("gear_direction_reversed");
  });

  it("returns null without a prediction, or off the registry", () => {
    // No prediction means nothing specific to point at, so the freeform engine keeps the call.
    expect(curatedLadderFor("gear-train", [frame, frame])).toBeNull();
    expect(curatedLadderFor("wire the breadboard", [frame, event("prediction", { answer: "3x" })])).toBeNull();
  });
});

describe("unlockedRung", () => {
  const misconception = DEMO_OBJECTIVES[0].misconceptions[0];

  it("ships the highest rung at or below the session's cap and withholds the rest", () => {
    // Redaction is unchanged: the cap from the event log decides, the ladder only supplies the text.
    expect(unlockedRung(misconception, "OBSERVE")).toBeNull();
    expect(unlockedRung(misconception, "POINT")?.rung).toBe(0);
    expect(unlockedRung(misconception, "ASK")?.rung).toBe(1);
    expect(unlockedRung(misconception, "EXPLAIN")?.rung).toBe(4);
    expect(rungLevel(0)).toBe("POINT");
    expect(rungLevel(4)).toBe("EXPLAIN");
  });
});

describe("listObjectives", () => {
  it("returns ids, titles and objective text with no ladders", () => {
    // The picker endpoint must not be a way to read the answers.
    const list = listObjectives();
    expect(list).toHaveLength(DEMO_OBJECTIVES.length);
    for (const entry of list) {
      expect(Object.keys(entry).sort()).toEqual(["id", "objective", "title"]);
    }
  });
});
