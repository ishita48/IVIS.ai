import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkBoundary, formatViolation, parseArgs } from "./boundary-check";

const roots: string[] = [];

function writeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "lens-boundary-"));
  roots.push(root);
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("boundary-check", () => {
  it("allows a client import chain that never reaches a server-only module", () => {
    // Client-safe imports keep the browser bundle independent from server infrastructure.
    const root = writeTree({
      "hooks/useThing.ts": '"use client";\nimport { safe } from "@/lib/safe";\nexport { safe };',
      "lib/safe.ts": "export const safe = true;",
      "lib/db.ts": 'import { MongoClient } from "mongodb";\nexport const db = MongoClient;',
    });

    expect(checkBoundary({ root })).toEqual([]);
  });

  it("reports the complete client chain when a value import reaches Mongo", () => {
    // The chain identifies the module that would make a client bundle crash.
    const root = writeTree({
      "hooks/usePointer.ts": '"use client";\nimport { pointer } from "./../lib/pointer";\nexport { pointer };',
      "lib/pointer.ts": 'import { events } from "@/lib/events";\nexport { events };',
      "lib/events.ts": 'import { MongoClient } from "mongodb";\nexport const events = MongoClient;',
    });

    const violations = checkBoundary({ root });
    expect(violations).toHaveLength(1);
    expect(formatViolation(violations[0])).toBe(
      "hooks/usePointer.ts → lib/pointer.ts → lib/events.ts → mongodb"
    );
  });

  it("ignores type-only imports because they are erased from the client bundle", () => {
    // Type-only imports cannot pull server code into a browser bundle.
    const root = writeTree({
      "hooks/useThing.ts": '"use client";\nimport type { X } from "@/lib/events";\nexport type Thing = X;',
      "lib/events.ts": 'import { MongoClient } from "mongodb";\nexport type X = typeof MongoClient;',
    });

    expect(checkBoundary({ root })).toEqual([]);
  });

  it("flags a configured forbidden package without treating it as forbidden by default", () => {
    // Configurable package rules let the same check protect other server-only integrations.
    const root = writeTree({
      "hooks/useClerk.ts": '"use client";\nimport { server } from "@/lib/server";\nexport { server };',
      "lib/server.ts": 'import { auth } from "@clerk/nextjs/server";\nexport const server = auth;',
    });

    expect(checkBoundary({ root })).toEqual([]);
    expect(checkBoundary({ root, forbid: ["@clerk/nextjs/server"] }).map(formatViolation)).toEqual([
      "hooks/useClerk.ts → lib/server.ts → @clerk/nextjs/server",
    ]);
  });

  it("parses the root, forbidden packages, and JSON output flag", () => {
    expect(parseArgs(["--root", "x", "--forbid", "a,b", "--json"])).toEqual({
      root: resolve("x"),
      forbid: ["a", "b"],
      json: true,
    });
  });
});
