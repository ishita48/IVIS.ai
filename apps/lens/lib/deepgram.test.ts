import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginCall,
  callInFlightAt,
  resetLedger,
  stampUtterance,
  trackCall,
  utteranceToEventPayload,
  type DeepgramResults,
} from "./deepgram";

/** Wall clock at which mic audio started flowing to Deepgram. */
const AUDIO_STARTED_AT = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AUDIO_STARTED_AT);
});

afterEach(() => {
  resetLedger();
  vi.useRealTimers();
});

const at = (offsetMs: number) => vi.setSystemTime(AUDIO_STARTED_AT + offsetMs);

const finalResult = (text: string, start: number, duration = 1.2): DeepgramResults => ({
  type: "Results",
  is_final: true,
  speech_final: true,
  start,
  duration,
  channel: { alternatives: [{ transcript: text, confidence: 0.93 }] },
});

describe("call ledger", () => {
  it("stamps an utterance with the vision call that was running when the student began speaking", () => {
    // The whole point: the words land on the frame LENS was looking at, not on the one after.
    at(2_000);
    const end = beginCall("vision", { objective: "LED polarity" });
    at(5_000);
    end();

    const u = stampUtterance(finalResult("I think the LED is backwards", 3.0), AUDIO_STARTED_AT);

    expect(u?.inFlight?.kind).toBe("vision");
    expect(u?.inFlight?.meta).toEqual({ objective: "LED polarity" });
    expect(u?.startedAt).toBe(AUDIO_STARTED_AT + 3_000);
  });

  it("stamps null when LENS was idle at the utterance start", () => {
    // Claiming a stamp that does not exist is worse than admitting there was none.
    at(10_000);
    const end = beginCall("analyze");
    at(12_000);
    end();

    const u = stampUtterance(finalResult("hmm", 1.0), AUDIO_STARTED_AT);

    expect(u?.inFlight).toBeNull();
  });

  it("stamps a call that is still in flight when the final result arrives", () => {
    // Analyze calls take seconds; the student talks over them and the final transcript lands first.
    at(500);
    beginCall("analyze");
    at(2_900);

    const u = stampUtterance(finalResult("wait, that loop never resets", 2.0), AUDIO_STARTED_AT);

    expect(u?.inFlight?.kind).toBe("analyze");
    expect(u?.inFlight?.endedAt).toBeNull();
  });

  it("prefers the most recently started call when two overlap", () => {
    // A vision call fired during an analyze call is the thing the student is reacting to.
    beginCall("analyze");
    at(1_000);
    beginCall("vision");
    at(2_000);

    const u = stampUtterance(finalResult("oh", 1.5), AUDIO_STARTED_AT);

    expect(u?.inFlight?.kind).toBe("vision");
  });

  it("trackCall records an end time even when the wrapped call rejects", async () => {
    // A failed vision call is still what the student was reacting to, and it must not stay open forever.
    await expect(
      trackCall("vision", async () => {
        throw new Error("503");
      })
    ).rejects.toThrow("503");

    expect(callInFlightAt(Date.now())?.endedAt).toBe(Date.now());
    expect(callInFlightAt(Date.now() + 1)).toBeNull();
  });
});

describe("stampUtterance", () => {
  it("ignores interim results, metadata frames, and empty transcripts", () => {
    // Only final speech becomes an event; anything else triples the event log with noise.
    expect(stampUtterance({ ...finalResult("still talk", 0), is_final: false }, AUDIO_STARTED_AT)).toBeNull();
    expect(stampUtterance({ type: "Metadata" }, AUDIO_STARTED_AT)).toBeNull();
    expect(stampUtterance(finalResult("   ", 0), AUDIO_STARTED_AT)).toBeNull();
  });

  it("derives the start from Deepgram's audio offset rather than the arrival time", () => {
    // Endpointing delays the final message by up to a second; the audio offset is when the student spoke.
    const u = stampUtterance(finalResult("okay", 4.25, 0.5), AUDIO_STARTED_AT);
    expect(u?.startedAt).toBe(AUDIO_STARTED_AT + 4_250);
    expect(u?.endedAt).toBe(AUDIO_STARTED_AT + 4_750);
  });
});

describe("utteranceToEventPayload", () => {
  it("writes a user voice_turn that lib/live-sessions.ts reads back into the transcript", () => {
    // The saved-session transcript reads role, text and at; break that shape and think-aloud vanishes from replay.
    const u = stampUtterance(finalResult("this resistor is wrong", 1.0), AUDIO_STARTED_AT)!;
    expect(utteranceToEventPayload(u)).toMatchObject({
      role: "user",
      channel: "think_aloud",
      source: "deepgram",
      text: "this resistor is wrong",
      at: AUDIO_STARTED_AT + 1_000,
      inFlight: null,
    });
  });
});
