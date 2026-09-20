/**
 * Server/client import boundary.
 *
 * PR #12 made a client hook reach lib/pointer.ts → token-ledger → events →
 * mongodb, and Next died on `child_process`. `tsc` cannot catch that: it does
 * not know which modules end up in the browser bundle. This test does what the
 * bundler does — starts at every `"use client"` file, walks value imports
 * (type-only imports are erased and ignored), and fails if the walk reaches a
 * module that talks to Mongo or reads a server secret.
 *
 * A failure here is a demo outage, not a style nit. Fix it by moving the thing
 * the client actually needs into a module with no server imports (see
 * lib/pointer-resolutions.ts), never by removing the check.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "hooks", "components", "app"];
const SKIP = new Set(["node_modules", ".next", "extension", "hardware", "public"]);

const SERVER_SEED = [
  /from\s*["']mongodb["']/,
  /process\.env\.(OPENAI_API_KEY|ANTHROPIC_API_KEY|ELEVENLABS_API_KEY|ELASTIC_(URL|API_KEY|PASSWORD|USERNAME)|MONGODB_URI|DROPBOX_ACCESS_TOKEN|GEMINI_API_KEY|GOOGLE_API_KEY|DEEPGRAM_API_KEY|CLERK_SECRET_KEY|CLERK_WEBHOOK_SECRET)\b/,
];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|d)\.tsx?$/.test(name)) out.push(p);
  }
}

function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

/** Value imports only. `import type` and all-`type` specifier lists are erased by the compiler. */
function valueImports(src: string): string[] {
  const out: string[] = [];
  const s = stripComments(src);
  const re = /import\s+([\s\S]*?)\s*from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|export\s+(type\s+)?(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[2] !== undefined) {
      const clause = m[1].trim();
      if (/^type\s/.test(clause)) continue;
      const braces = clause.match(/\{([\s\S]*)\}/);
      const outside = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
      if (!outside && braces) {
        const specs = braces[1].split(",").map((x) => x.trim()).filter(Boolean);
        if (specs.length && specs.every((x) => /^type\s/.test(x))) continue;
      }
      out.push(m[2]);
    } else if (m[3] !== undefined) out.push(m[3]);
    else if (m[5] !== undefined) { if (!m[4]) out.push(m[5]); }
    else if (m[6] !== undefined) out.push(m[6]);
  }
  return out;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // external package — only matters if it is "mongodb", handled by SERVER_SEED
  for (const cand of [base, base + ".ts", base + ".tsx", join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function isClientEntry(src: string) {
  return /^\s*(["'])use client\1/m.test(src.slice(0, 400));
}

describe("client bundles never reach server modules", () => {
  it("no \"use client\" file value-imports its way to Mongo or a server secret", () => {
    expect(existsSync(join(ROOT, "lib"))).toBe(true);
    const files: string[] = [];
    for (const d of SCAN_DIRS) if (existsSync(join(ROOT, d))) walk(join(ROOT, d), files);

    const src = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
    const isServer = (f: string) => SERVER_SEED.some((re) => re.test(stripComments(src.get(f) ?? "")));
    const rel = (f: string) => f.slice(ROOT.length + 1);

    const violations: string[] = [];
    for (const entry of files) {
      if (!isClientEntry(src.get(entry)!)) continue;
      const seen = new Set<string>();
      const stack: [string, string[]][] = [[entry, [rel(entry)]]];
      while (stack.length) {
        const [file, chain] = stack.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        if (file !== entry && isServer(file)) { violations.push(chain.join("  →  ")); continue; }
        for (const spec of valueImports(src.get(file) ?? "")) {
          const target = resolveSpec(file, spec);
          if (target && src.has(target) && !seen.has(target)) stack.push([target, [...chain, rel(target)]]);
        }
      }
    }
    expect(violations, "\n" + violations.join("\n") + "\n").toEqual([]);
  });
});
