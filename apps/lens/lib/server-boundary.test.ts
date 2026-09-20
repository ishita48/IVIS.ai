/**
 * Server/client import boundary.
 *
 * PR #12 made a client hook reach Mongo through a value-import chain.
 * Next died on `child_process`, and `tsc` could not catch the browser boundary.
 * The reusable walker lives in scripts/boundary-check.ts.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkBoundary, formatViolation } from "../scripts/boundary-check";

describe("client bundles never reach server modules", () => {
  it("no \"use client\" file value-imports its way to Mongo or a server secret", () => {
    const root = process.cwd();
    expect(existsSync(join(root, "lib"))).toBe(true);
    const violations = checkBoundary({ root });
    expect(violations.map(formatViolation), "\n" + violations.map(formatViolation).join("\n") + "\n").toEqual([]);
  });
});
