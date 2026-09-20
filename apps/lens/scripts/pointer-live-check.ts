/**
 * LENS Pointer + Guide — LIVE check.  `npx tsx scripts/pointer-live-check.ts`
 * ─────────────────────────────────────────────────────────────────────
 * lib/guide-check.ts stubs the network and proves our handling of a
 * response. This one spends real Computer Use calls to answer the question
 * that check cannot: does Claude actually read the screen we send, and do
 * the coordinates land where the thing is?
 *
 *   1. A synthetic 1280x800 frame with one red rectangle at a known place.
 *      "Where is the red button?" must come back inside that rectangle.
 *      Deterministic pass/fail — this is the accuracy test.
 *   2. The same frame through the Guide path with a goal that needs the
 *      button. Same rectangle, same pass/fail, plus the why must be a
 *      question.
 *   3. A real screenshot of this Mac (macOS `screencapture`), resized to the
 *      declared resolution exactly as hooks/usePointer.ts does. Not
 *      pass/fail — it prints what Claude says it is LOOKING AT so a human
 *      can see it described the real screen and not a hallucination.
 *
 * Reads ANTHROPIC_API_KEY from .env.local. Costs roughly three Sonnet calls.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── .env.local, by hand: no dotenv dependency in this package ────────
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

import { locateOnScreen } from "@/lib/pointer";
import { nextGuideStep } from "@/lib/guide";

// ── A minimal PNG encoder (RGB, no deps) ─────────────────────────────
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const W = 1280, H = 800;
// The "button": a red block in the lower-right quadrant, plus a grey
// distractor top-left so "the only thing on screen" is not the answer.
const BTN = { x: 880, y: 560, w: 200, h: 60 };
const DIS = { x: 120, y: 120, w: 200, h: 60 };
const inside = (p: { x: number; y: number } | null | undefined, r: typeof BTN) =>
  !!p && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

const frame = png(W, H, (x, y) => {
  if (x >= BTN.x && x < BTN.x + BTN.w && y >= BTN.y && y < BTN.y + BTN.h) return [220, 30, 30];
  if (x >= DIS.x && x < DIS.x + DIS.w && y >= DIS.y && y < DIS.y + DIS.h) return [170, 170, 170];
  return [255, 255, 255];
}).toString("base64");

(async () => {
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};
const px = { declared: { width: W, height: H }, capture: { width: W, height: H } };

console.log("\n1. Pointer: synthetic frame, red button at", BTN);
const t0 = Date.now();
const target = await locateOnScreen({ imageBase64: frame, question: "Where is the red button?", mediaType: "image/png", ...px });
console.log(`     ${Date.now() - t0}ms  →`, target && { x: target.x, y: target.y, label: target.label });
console.log(`     LOOKING AT: ${target?.observation ?? "(no narration)"}`);
check("coordinate lands inside the red button", inside(target, BTN), JSON.stringify(target && { x: target.x, y: target.y }));
check("not on the grey distractor", !inside(target, DIS));
check("observation mentions red", /red/i.test(target?.observation ?? ""));

console.log("\n2. Guide: same frame, goal needs the red button");
const t1 = Date.now();
const step = await nextGuideStep({
  goal: "Press the red button", imageBase64: frame, mediaType: "image/png", history: [],
  pageUrl: "about:blank", pageTitle: "Test page", ...px,
});
console.log(`     ${Date.now() - t1}ms  →`, { step: step.step, why: step.why, status: step.status, target: step.target && { x: step.target.x, y: step.target.y } });
check("ring lands inside the red button", inside(step.target, BTN));
check("why is a question or null", step.why === null || /\?\s*$/.test(step.why), JSON.stringify(step.why));

console.log("\n3. Real screen: macOS screencapture → resize like the client → Pointer");
const shot = join(tmpdir(), `lens-pointer-${Date.now()}.png`);
try {
  execFileSync("screencapture", ["-x", "-t", "png", shot]);
  const dims = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", shot]).toString();
  const cw = Number(/pixelWidth: (\d+)/.exec(dims)?.[1]), ch = Number(/pixelHeight: (\d+)/.exec(dims)?.[1]);
  // Same rule as hooks/usePointer.ts: draw at exactly the declared size.
  execFileSync("sips", ["-z", String(H), String(W), shot]);
  const real = readFileSync(shot).toString("base64");
  const t2 = Date.now();
  const r = await locateOnScreen({
    imageBase64: real, question: "What is on my screen right now, and where is the clock in the menu bar?",
    mediaType: "image/png", declared: { width: W, height: H }, capture: { width: cw, height: ch },
  });
  console.log(`     ${Date.now() - t2}ms  capture=${cw}x${ch} declared=${W}x${H}`);
  console.log(`     LOOKING AT: ${r?.observation ?? "(no narration)"}`);
  console.log(`     POINTING AT: ${r?.label ?? "(nothing)"}  at`, r && { x: r.x, y: r.y, nx: +r.nx.toFixed(3), ny: +r.ny.toFixed(3) });
  check("Claude described the real screen (narration is not empty)", (r?.observation ?? "").length > 20);
  check("menu-bar clock is near the top edge", !!r && r.ny < 0.05, r ? `ny=${r.ny.toFixed(3)}` : "no target");
} catch (e) {
  check("screencapture ran (needs Screen Recording permission for the terminal)", false, (e as Error).message.slice(0, 120));
} finally {
  if (existsSync(shot)) unlinkSync(shot);
}

console.log(`\n${"─".repeat(50)}\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
})();
