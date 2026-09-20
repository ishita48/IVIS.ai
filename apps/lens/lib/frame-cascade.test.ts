import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideCascade,
  DEFAULT_THROTTLE_MS,
  rememberAnalysis,
  resetCascade,
  throttleMs,
} from "./frame-cascade";
import { recordSkip } from "./token-ledger";

vi.mock("./token-ledger", () => ({ recordSkip: vi.fn(async () => null) }));

afterEach(resetCascade);
afterEach(() => vi.clearAllMocks());

const scope = { sessionId: "session-1", userId: "user-1" };

describe("frame cascade", () => {
  it("does not skip the first frame for a session", () => {
    // The first look must reach vision so the tutor has evidence to work from.
    const decision = decideCascade({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,first",
      now: 1_000,
    });

    expect(decision).toEqual({ skip: false });
    expect(recordSkip).not.toHaveBeenCalled();
  });

  it("skips an identical data URL after remembering the prior observation", () => {
    // Re-reading the same frame wastes model budget without adding evidence.
    const observation = { observation: "The resistor is visible." };
    rememberAnalysis({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,same",
      observation,
      now: 1_000,
    });

    const decision = decideCascade({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,same",
      now: 2_000,
    });

    expect(decision).toEqual({ skip: true, reason: "unchanged_frame", prior: observation });
    expect(recordSkip).toHaveBeenCalledOnce();
    expect(recordSkip).toHaveBeenCalledWith(expect.objectContaining({ reason: "unchanged_frame" }));
  });

  it("skips a different frame when the client reports that the scene is unchanged", () => {
    // The motion watcher already knows when a new model look cannot add evidence.
    const observation = { observation: "The work area is visible." };
    rememberAnalysis({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,first",
      observation,
      now: 1_000,
    });

    const decision = decideCascade({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,different",
      sceneChanged: false,
      now: 5_000,
    });

    expect(decision).toEqual({ skip: true, reason: "scene_unchanged", prior: observation });
    expect(recordSkip).toHaveBeenCalledWith(expect.objectContaining({ reason: "scene_unchanged" }));
  });

  it("throttles a changed frame inside the call window but allows it at the boundary", () => {
    // A short camera burst should not turn one stable observation into repeated calls.
    const observation = { observation: "The work area is visible." };
    rememberAnalysis({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,first",
      observation,
      now: 10_000,
    });

    const throttled = decideCascade({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,different",
      now: 11_000,
    });
    const allowed = decideCascade({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,different",
      now: 14_000,
    });

    expect(throttled).toEqual({ skip: true, reason: "throttled", prior: observation });
    expect(allowed).toEqual({ skip: false });
  });

  it("does not skip a different objective inside the throttle window", () => {
    // A new objective changes what evidence the tutor needs from the same workspace.
    rememberAnalysis({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,first",
      observation: { observation: "The resistor is visible." },
      now: 10_000,
    });

    const decision = decideCascade({
      scope,
      objective: "check the LED",
      frameDataUrl: "data:image/jpeg;base64,different",
      now: 11_000,
    });

    expect(decision).toEqual({ skip: false });
  });

  it("does not skip an identical frame when force is true", () => {
    // The tutor can demand a fresh look when the student explicitly asks for one.
    rememberAnalysis({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,same",
      observation: { observation: "The resistor is visible." },
      now: 10_000,
    });

    const decision = decideCascade({
      scope,
      objective: "check the resistor",
      frameDataUrl: "data:image/jpeg;base64,same",
      force: true,
      now: 11_000,
    });

    expect(decision).toEqual({ skip: false });
  });

  it("uses the environment throttle override for changed frames", () => {
    // The demo can tune camera cost without changing the cascade code.
    const prior = process.env.LENS_VISION_THROTTLE_MS;
    process.env.LENS_VISION_THROTTLE_MS = "1500";

    try {
      expect(throttleMs()).toBe(1500);
      expect(DEFAULT_THROTTLE_MS).toBe(4000);
    } finally {
      if (prior === undefined) delete process.env.LENS_VISION_THROTTLE_MS;
      else process.env.LENS_VISION_THROTTLE_MS = prior;
    }
  });
});
