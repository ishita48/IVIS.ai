/**
 * Server/client import boundary.
 *
 * PR #12 made a client hook reach lib/pointer.ts → token-ledger → events →
 * mongodb, and Next died on `child_process`. `tsc` cannot catch that because
 * it does not know which modules end up in the browser bundle. This checker
 * follows value imports from every `"use client"` file and reports the chain
 * when it reaches a server-only module.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface BoundaryOptions {
  root: string;
  forbid?: string[];
  scanDirs?: string[];
  skip?: string[];
}

export interface Violation {
  chain: string[];
}

const DEFAULT_FORBID = ["mongodb"];
const DEFAULT_SCAN_DIRS = ["lib", "hooks", "components", "app"];
const DEFAULT_SKIP = ["node_modules", ".next", "extension", "hardware", "public"];

const SERVER_SECRET_ENV =
  /process\.env\.(OPENAI_API_KEY|ANTHROPIC_API_KEY|ELEVENLABS_API_KEY|ELASTIC_(URL|API_KEY|PASSWORD|USERNAME)|MONGODB_URI|DROPBOX_ACCESS_TOKEN|GEMINI_API_KEY|GOOGLE_API_KEY|DEEPGRAM_API_KEY|CLERK_SECRET_KEY|CLERK_WEBHOOK_SECRET)\b/;

function walk(dir: string, out: string[], skip: Set<string>) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out, skip);
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
    else if (m[5] !== undefined) {
      if (!m[4]) out.push(m[5]);
    } else if (m[6] !== undefined) out.push(m[6]);
  }
  return out;
}

function resolveSpec(root: string, fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const cand of [base, base + ".ts", base + ".tsx", join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function isClientEntry(src: string) {
  return /^\s*(["'])use client\1/m.test(src.slice(0, 400));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serverReason(src: string, forbid: string[]): string | null {
  const clean = stripComments(src);
  for (const pkg of forbid) {
    if (!pkg) continue;
    const re = new RegExp(`from\\s*["']${escapeRegex(pkg)}(?:/[^"']*)?["']`);
    if (re.test(clean)) return pkg;
  }
  const secret = SERVER_SECRET_ENV.exec(clean);
  return secret ? `process.env.${secret[1]}` : null;
}

interface BoundaryReport {
  filesScanned: number;
  clientEntries: number;
  violations: Violation[];
  scanDirsFound: number;
}

function inspect(opts: BoundaryOptions): BoundaryReport {
  const root = resolve(opts.root);
  const forbid = opts.forbid ?? DEFAULT_FORBID;
  const scanDirs = opts.scanDirs ?? DEFAULT_SCAN_DIRS;
  const skip = new Set(opts.skip ?? DEFAULT_SKIP);
  const files: string[] = [];
  let scanDirsFound = 0;

  for (const dir of scanDirs) {
    const path = join(root, dir);
    if (!existsSync(path) || !statSync(path).isDirectory()) continue;
    scanDirsFound++;
    walk(path, files, skip);
  }

  const src = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
  const rel = (file: string) => relative(root, file);
  const violations: Violation[] = [];
  let clientEntries = 0;

  for (const entry of files) {
    if (!isClientEntry(src.get(entry)!)) continue;
    clientEntries++;
    const seen = new Set<string>();
    const stack: [string, string[]][] = [[entry, [rel(entry)]]];
    while (stack.length) {
      const [file, chain] = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const reason = serverReason(src.get(file) ?? "", forbid);
      if (file !== entry && reason) {
        violations.push({ chain: [...chain, reason] });
        continue;
      }
      for (const spec of valueImports(src.get(file) ?? "")) {
        const target = resolveSpec(root, file, spec);
        if (target && src.has(target) && !seen.has(target)) {
          stack.push([target, [...chain, rel(target)]]);
        }
      }
    }
  }

  return { filesScanned: files.length, clientEntries, violations, scanDirsFound };
}

export function checkBoundary(opts: BoundaryOptions): Violation[] {
  return inspect(opts).violations;
}

export function formatViolation(v: Violation): string {
  return v.chain.join(" → ");
}

export function parseArgs(argv: string[]): { root: string; forbid: string[]; json: boolean } {
  let root = process.cwd();
  let forbid = DEFAULT_FORBID;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1]) {
      root = resolve(argv[++i]);
    } else if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
    } else if (arg === "--forbid" && argv[i + 1] !== undefined) {
      forbid = argv[++i].split(",").filter(Boolean);
    } else if (arg.startsWith("--forbid=")) {
      forbid = arg.slice("--forbid=".length).split(",").filter(Boolean);
    } else if (arg === "--json") {
      json = true;
    }
  }

  return { root, forbid, json };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.root) || !statSync(args.root).isDirectory()) {
    console.error(`boundary check root does not exist: ${args.root}`);
    process.exitCode = 2;
    return;
  }

  const report = inspect({ root: args.root, forbid: args.forbid });
  if (!report.scanDirsFound) {
    console.error(`boundary check found no scan directories under: ${args.root}`);
    process.exitCode = 2;
    return;
  }

  if (args.json) {
    console.log(JSON.stringify({ ok: report.violations.length === 0, violations: report.violations }));
  } else if (report.violations.length) {
    console.error(`✗ ${report.violations.length} boundary violation(s)`);
    for (const violation of report.violations) console.error(formatViolation(violation));
  } else {
    console.log(`✓ boundary clean (${report.clientEntries} client entries, ${report.filesScanned} files scanned)`);
  }

  if (report.violations.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
