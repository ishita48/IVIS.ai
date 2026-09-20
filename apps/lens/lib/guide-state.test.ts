import { describe, expect, it, vi } from "vitest";

// guide-state.ts imports the event store, which needs MONGODB_URI at module
// load. The pure reader under test never calls it.
vi.mock("./events", () => ({ recentEvents: vi.fn() }));

import { guideStepsFromEvents } from "./guide-state";
import type { LensEvent } from "./lens/contracts";

const stepEvent = (
  step: string,
  timestamp: string,
  payload: Record<string, unknown> = {},
  userId = "user_1"
): LensEvent => ({
  sessionId: "session_1",
  userId,
  type: "guide_step",
  concept: null,
  payload: {
    goal: "Install the extension",
    step,
    askedWhy: true,
    why: "Why does the page need reloading?",
    status: "on_track",
    observation: "The toolbar shows the new icon.",
    pointed: true,
    x: 420,
    y: 36,
    index: 2,
    pageUrl: "https://example.com",
    mode: "extension",
    ...payload,
  },
  timestamp,
});

describe("guideStepsFromEvents", () => {
  it("returns the newest step first when events arrive oldest-first", () => {
    // The agent must answer "what do I do next" with the current step, not the first one.
    const steps = guideStepsFromEvents([
      stepEvent("Click the puzzle icon", "2026-09-19T10:00:00.000Z"),
      stepEvent("Pin LENS to the toolbar", "2026-09-19T10:02:00.000Z"),
    ]);

    expect(steps.map((s) => s.step)).toEqual([
      "Pin LENS to the toolbar",
      "Click the puzzle icon",
    ]);
  });

  it("ignores non-guide events that share the same session", () => {
    // Prediction and model_call rows live in the same collection; none of them may read as steps.
    const other: LensEvent = {
      sessionId: "session_1",
      userId: "user_1",
      type: "prediction",
      payload: { answer: "it breaks", question: "what happens?" },
      timestamp: "2026-09-19T10:03:00.000Z",
    };

    const steps = guideStepsFromEvents([
      stepEvent("Click the puzzle icon", "2026-09-19T10:00:00.000Z"),
      other,
    ]);

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("Click the puzzle icon");
  });

  it("maps x and y into a target and leaves target null when the step pointed at nothing", () => {
    // The voice agent says "the button top-right" only when the extension actually pointed.
    const [pointed, unpointed] = guideStepsFromEvents([
      stepEvent("Click the puzzle icon", "2026-09-19T10:00:00.000Z"),
      stepEvent("Done — the icon is pinned", "2026-09-19T10:04:00.000Z", {
        pointed: false,
        x: null,
        y: null,
      }),
    ]);

    expect(pointed.target).toBeNull();
    expect(unpointed.target).toEqual({ x: 420, y: 36 });
  });

  it("drops another user's guide_step rows when a userId is given", () => {
    // Two students can share a session id shape; the agent must never read aloud someone else's step.
    const steps = guideStepsFromEvents(
      [
        stepEvent("My step", "2026-09-19T10:00:00.000Z"),
        stepEvent("Someone else's step", "2026-09-19T10:05:00.000Z", {}, "user_2"),
      ],
      "user_1"
    );

    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe("My step");
  });

  it("falls back to on_track for an unknown status and tolerates missing why and observation", () => {
    // A half-written row should still answer "what do I do next" rather than crash the tool call.
    const [step] = guideStepsFromEvents([
      stepEvent("Click the puzzle icon", "2026-09-19T10:00:00.000Z", {
        status: "sideways",
        why: undefined,
        observation: undefined,
      }),
    ]);

    expect(step.status).toBe("on_track");
    expect(step.why).toBeNull();
    expect(step.observation).toBeNull();
  });
});
