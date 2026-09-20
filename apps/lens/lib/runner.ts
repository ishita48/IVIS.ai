/**
 * Local JavaScript execution — the checker's engine.
 * ─────────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS AT ALL:
 *
 * lib/sandbox.ts ran student code on the public Piston instance at
 * emkc.org. As of 2026-02-15 that endpoint is whitelist-only and answers
 * every request with 401. Self-hosting Piston means a Docker host, which
 * a Vercel deployment does not have.
 *
 * That mattered more than a normal outage would, because the claim the
 * Proof tier makes is "the checker decides, the model explains". If code
 * cannot actually run, that sentence is marketing. So execution moved
 * in-process: Node has a JavaScript engine already, and every fixture in
 * fixtures/bugs.json is JavaScript.
 *
 * WHY NOT RUN IT IN THE BROWSER, which would be even simpler: because then
 * the verdict would be a claim the client makes about itself. The server
 * would be taking "I passed" on faith, and the hint ladder — which decides
 * how much help a student has earned — reads from that same verdict. The
 * checker has to be somewhere the student cannot edit.
 *
 * WHAT CONTAINS IT:
 *
 *   1. A worker thread, so a runaway program blocks its own thread and not
 *      the request handler, and so it can be killed from outside.
 *   2. `vm.runInContext` with a timeout, which interrupts synchronous code
 *      — and in a bare context all student code is synchronous, because
 *      there are no timers to schedule anything onto.
 *   3. A context containing nothing but `console` and the input. No
 *      `require`, no `process`, no `fetch`, no `globalThis` from out here.
 *   4. `resourceLimits`, so `new Array(1e12)` dies as an OOM in the worker
 *      rather than as an OOM in the function.
 *   5. A `terminate()` on a longer fuse, for the case where the vm timeout
 *      is somehow evaded.
 *
 * This is a robustness boundary, not a security boundary. `vm` is
 * documented as not being a security mechanism, and a determined escape
 * from a V8 context is a known genre of bug. What sits behind it is a
 * fixture file and a hint prompt — no credentials are read in this
 * process path — and the code being run is the student's own, typed into
 * their own editor. If this ever runs untrusted code from one user on
 * behalf of another, it needs a real container instead.
 */

import { Worker } from "node:worker_threads";

/**
 * Parse one textual input into the value the program receives.
 *
 * Callers hold their inputs as text (fixtures write them as JSON strings,
 * and the old Piston path passed them as stdin), but the runner injects a
 * real value. This is the one place that conversion happens, so a fixture
 * and a shrink candidate can never disagree about what `[1, 2]` means.
 */
export function parseInput(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return t; // A bare string that isn't valid JSON is still a string.
  }
}

export type LocalRunResult = {
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/** Default synchronous budget. Generous for a 20-line bug, fatal to a while(true). */
const DEFAULT_TIMEOUT_MS = 4_000;

/** How long after the vm timeout we stop being polite and kill the thread. */
const TERMINATE_GRACE_MS = 1_500;

/**
 * The worker program, inlined as a string rather than kept in its own file.
 *
 * `new Worker(src, { eval: true })` has no path to resolve, so there is
 * nothing for Next's file tracing to miss when bundling for Vercel — a
 * separate .cjs worker would need an explicit outputFileTracingIncludes
 * entry and would fail in production only.
 *
 * `\\n` inside this template literal is a literal backslash-n in the
 * emitted worker source, which the worker then parses as a newline.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");

const stdout = [];
const stderr = [];

function fmt(v) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

// Caps so a logging loop cannot fill memory before the timeout lands.
function push(target, args) {
  if (target.length >= 500) return;
  target.push(args.map(fmt).join(" "));
}

const sandbox = {
  console: {
    log: (...a) => push(stdout, a),
    info: (...a) => push(stdout, a),
    debug: (...a) => push(stdout, a),
    warn: (...a) => push(stderr, a),
    error: (...a) => push(stderr, a),
  },
  // The one value the harness reads. Structured-cloned on the way in, so
  // it shares nothing with the host realm.
  __lensInput: workerData.input,
};

let thrown = "";
try {
  vm.createContext(sandbox);
  vm.runInContext(workerData.source, sandbox, {
    timeout: workerData.timeoutMs,
    filename: "student.js",
    displayErrors: true,
  });
} catch (e) {
  // The student sees the error they caused; the frames below it are ours.
  const msg = e && e.message ? String(e.message) : String(e);
  const line = e && e.stack
    ? String(e.stack).split("\\n").find((l) => l.includes("student.js"))
    : null;
  thrown = line ? msg + " (" + line.trim() + ")" : msg;
}

parentPort.postMessage({
  stdout: stdout.join("\\n"),
  stderr: thrown || stderr.join("\\n"),
});
`;

/**
 * Run a JavaScript program with one pre-parsed input value available as the
 * global `__lensInput`, and collect what it logs.
 *
 * Never throws for anything the student did — a syntax error, an exception
 * and a timeout all come back as a result with `stderr` set, because all
 * three are things the editor has to render rather than things the request
 * failed at.
 */
export async function runJavaScript(opts: {
  source: string;
  input?: unknown;
  timeoutMs?: number;
}): Promise<LocalRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<LocalRunResult>((resolve) => {
    let settled = false;
    const done = (r: LocalRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(fuse);
      void worker.terminate();
      resolve(r);
    };

    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { source: opts.source, input: opts.input, timeoutMs },
      // No inherited environment: nothing in this process's env is any of
      // the student program's business.
      env: {},
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
      stdout: true,
      stderr: true,
    });

    const fuse = setTimeout(() => {
      done({
        stdout: "",
        stderr: `Took longer than ${timeoutMs}ms and was stopped. Is there a loop that never ends?`,
        timedOut: true,
      });
    }, timeoutMs + TERMINATE_GRACE_MS);

    worker.on("message", (m: { stdout?: string; stderr?: string }) => {
      const stderrText = String(m?.stderr ?? "");
      // vm reports its own timeout as an exception, which is a timeout and
      // should read like one rather than like a bug in their code.
      const timedOut = /Script execution timed out/i.test(stderrText);
      done({
        stdout: String(m?.stdout ?? ""),
        stderr: timedOut
          ? `Took longer than ${timeoutMs}ms and was stopped. Is there a loop that never ends?`
          : stderrText,
        timedOut,
      });
    });

    worker.on("error", (e) => {
      // Reaches here for a parse failure in the student's source and for
      // the heap limit being hit.
      const msg = e?.message || String(e);
      done({
        stdout: "",
        stderr: /heap out of memory|Array buffer allocation/i.test(msg)
          ? "Ran out of memory. Is something growing without bound?"
          : msg,
        timedOut: false,
      });
    });

    worker.on("exit", (code) => {
      if (code === 0) {
        // Exited without posting — nothing ran, nothing to report.
        done({ stdout: "", stderr: "", timedOut: false });
      } else {
        done({
          stdout: "",
          stderr: `The program stopped unexpectedly (exit ${code}).`,
          timedOut: false,
        });
      }
    });
  });
}
