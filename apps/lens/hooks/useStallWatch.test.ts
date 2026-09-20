import { describe, expect, it } from "vitest";
import { meanLumaDelta } from "./useStallWatch";

/** An RGBA buffer of `n` pixels, every channel set to `v`. */
const flat = (n: number, v: number) =>
  new Uint8ClampedArray(Array.from({ length: n * 4 }, () => v));

describe("meanLumaDelta", () => {
  it("is zero for identical frames", () => {
    expect(meanLumaDelta(flat(16, 120), flat(16, 120))).toBe(0);
  });

  it("measures the luma gap between two flat frames", () => {
    // Luma of a grey pixel is the grey value, so the mean delta is the gap.
    expect(meanLumaDelta(flat(16, 100), flat(16, 130))).toBeCloseTo(30, 5);
  });

  it("averages over the whole frame, so one moving pixel stays small", () => {
    const a = flat(16, 100);
    const b = flat(16, 100);
    b[0] = b[1] = b[2] = 255;
    // One pixel of 16 swinging 155 levels — well under the movement threshold.
    expect(meanLumaDelta(a, b)).toBeCloseTo(155 / 16, 5);
  });

  it("reports movement when the frames cannot be compared", () => {
    // Unknown must read the same as moved, or a look gets skipped wrongly.
    expect(meanLumaDelta(flat(0, 0), flat(16, 100))).toBe(Number.POSITIVE_INFINITY);
    expect(meanLumaDelta(flat(4, 100), flat(16, 100))).toBe(Number.POSITIVE_INFINITY);
  });
});
