import { describe, expect, it } from "vitest";
import {
  askedQuestions,
  countAttempts,
  nextAllowedLevel,
  sameQuestion,
  studentSpokeSince,
} from "./ladder";
import type { LensEvent } from "./lens/contracts";

let tick = 0;
const at = (offsetMs = 0) => new Date(1_700_000_000_000 + (tick += 1000) + offsetMs).toISOString();

const event = (type: LensEvent["type"], payload: Record<string, unknown> = {}): LensEvent => ({
  sessionId: "s",
  type,
  payload,
  timestamp: at(),
});
const agent = (text: string) => event("voice_turn", { role: "agent", text });
const student = (text: string) => event("voice_turn", { role: "user", text });
const frame = () => event("camera_frame_analyzed", { observation: "a hand" });

describe("nextAllowedLevel", () => {
  it("starts at POINT with no attempts", () => {
    expect(nextAllowedLevel([frame(), frame()])).toBe("POINT");
  });

  it("climbs one rung per recorded attempt", () => {
    expect(nextAllowedLevel([frame(), event("prediction", { answer: "3x" })])).toBe("ASK");
    expect(
      nextAllowedLevel([frame(), event("prediction"), event("retry")])
    ).toBe("NUDGE");
  });

  it("counts a spoken reply to a tutor question as an attempt", () => {
    // This is the loop from the demo: the student answered, so the ladder
    // must move rather than hand the agent the same question again.
    const events = [frame(), agent("How many meshes do you count?"), student("I don't know. You tell me.")];
    expect(countAttempts(events)).toBe(1);
    expect(nextAllowedLevel(events)).toBe("ASK");
  });

  it("counts several replies to one question once", () => {
    const events = [
      frame(),
      agent("How many meshes do you count?"),
      student("Three?"),
      student("Or maybe nine."),
    ];
    expect(countAttempts(events)).toBe(1);
  });

  it("does not count a reply to a statement, or a reply before any question", () => {
    expect(countAttempts([frame(), student("hey what's up"), agent("I see a gear train."), student("ok")])).toBe(0);
  });

  it("never goes past EXPLAIN", () => {
    const events: LensEvent[] = [frame()];
    for (let i = 0; i < 10; i += 1) {
      events.push(agent(`Question ${i}?`), student(`Answer ${i}`));
    }
    expect(nextAllowedLevel(events)).toBe("EXPLAIN");
  });
});

describe("sameQuestion", () => {
  it("ignores case and punctuation", () => {
    expect(sameQuestion("What do you see?", "what do you see")).toBe(true);
  });
  it("treats a question with a trailing tag as the same question", () => {
    expect(
      sameQuestion(
        "Look closely at your hand and count each finger one by one.",
        "Look closely at your hand and count each finger one by one. What do you find?"
      )
    ).toBe(true);
  });
  it("keeps different questions apart", () => {
    expect(sameQuestion("How many meshes are there?", "Which way does the output turn?")).toBe(false);
    expect(sameQuestion("", "anything")).toBe(false);
  });
});

describe("askedQuestions", () => {
  it("returns only the tutor's questions, most recent last", () => {
    const events = [agent("I'm LENS. What are you working on?"), student("a gear"), agent("Nice."), agent("How many meshes?")];
    expect(askedQuestions(events)).toEqual(["I'm LENS. What are you working on?", "How many meshes?"]);
  });
});

describe("studentSpokeSince", () => {
  it("is true only for a student turn after the timestamp", () => {
    const before = student("early");
    const marker = at();
    expect(studentSpokeSince([before], marker)).toBe(false);
    expect(studentSpokeSince([before, agent("q?")], marker)).toBe(false);
    expect(studentSpokeSince([before, student("late")], marker)).toBe(true);
    expect(studentSpokeSince([student("x")], undefined)).toBe(false);
  });
});
