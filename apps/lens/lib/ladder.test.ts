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
const predicted = () => event("prediction", { answer: "3x" });

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

  it("ignores chit-chat the mic caught before the session was engaged", () => {
    // The run that found this: the student was talking to a friend while
    // the tutor greeted them, and five replies unlocked EXPLAIN.
    const events: LensEvent[] = [];
    for (let i = 0; i < 5; i += 1) {
      events.push(agent(`Question ${i}?`), student(`Answer ${i}`));
    }
    expect(countAttempts(events)).toBe(0);
    expect(nextAllowedLevel(events)).toBe("POINT");
  });

  it("counts a prediction and the replies that follow it", () => {
    const events = [
      predicted(),
      agent("Why three?"),
      student("Because of the tooth count."),
      agent("And which way does it turn?"),
      student("Clockwise."),
    ];
    expect(countAttempts(events)).toBe(3);
    expect(nextAllowedLevel(events)).toBe("EXPERIMENT");
  });

  it("counts replies after the first engagement event, not before", () => {
    const events = [
      agent("Hi, what are you working on?"),
      student("I'm working on code."),
      agent("Which part?"),
      student("The front end."),
      predicted(),
      agent("So what happens at the output?"),
      student("It flips."),
    ];
    // The prediction, plus the one reply that came after it. The two
    // before it are conversation, not attempts.
    expect(countAttempts(events)).toBe(2);
    expect(nextAllowedLevel(events)).toBe("NUDGE");
  });

  it("counts recorded attempts whether or not anything engaged the session", () => {
    const events = [event("retry"), event("experiment_completed")];
    expect(countAttempts(events)).toBe(2);
    expect(nextAllowedLevel(events)).toBe("NUDGE");
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
