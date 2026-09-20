/**
 * LENS Guide — self-check.  `npm run guide:check`
 * ─────────────────────────────────────────────────────────────────────
 * Exercises everything in lib/guide.ts on THIS side of the network call:
 * the request shape sent to Computer Use, JSON parsing, the why-sanitizer,
 * and clamp-then-rescale. The Anthropic call itself is stubbed, so this
 * runs without a key and without spending one — it proves our handling of
 * a response, not the model's aim.
 *
 * Section 4 is the one that matters most. `why` is the field a student
 * reads as a question, and a model that answers itself there breaks the
 * only claim this product makes. If that section ever goes red, the fix
 * is in sanitizeWhy, not in the test.
 */
process.env.ANTHROPIC_API_KEY = "sk-ant-test-0000000000000000";
import { nextGuideStep } from "@/lib/guide";

let lastRequest: any = null;

function stub(content: any[]) {
  (globalThis as any).fetch = async (_url: string, init: any) => {
    lastRequest = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content }) } as any;
  };
}

const base = {
  goal: "Launch a t3.micro EC2 instance in us-east-1",
  imageBase64: "AAAA",
  history: [] as string[],
  pageUrl: "https://console.aws.amazon.com/ec2",
  pageTitle: "EC2",
};
const px = { declared: { width: 1280, height: 800 }, capture: { width: 1280, height: 800 } };

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const text = (o: any) => ({ type: "text", text: JSON.stringify(o) });
const click = (x: number, y: number) => ({ type: "tool_use", input: { coordinate: [x, y] } });

(async () => {
  console.log("\n1. Request shape sent to Computer Use");
  stub([text({ observation: "o", step: "Click Launch instances.", why: "What is a t3.micro?", status: "on_track" }), click(1187, 134)]);
  let r = await nextGuideStep({ ...base, ...px });
  const tool = lastRequest.tools[0];
  check("computer tool is DECLARED", tool.name === "computer" && tool.type.startsWith("computer_"));
  check("declared dims match the image", tool.display_width_px === 1280 && tool.display_height_px === 800);
  check("goal is in the prompt", /t3\.micro/.test(lastRequest.messages[0].content[1].text));
  check("history section renders empty-state", /nothing yet/.test(lastRequest.messages[0].content[1].text));

  console.log("\n2. Coordinate lands on the real button rect {x:1116,y:118,w:142,h:32}");
  check("HIT", !!r.target && r.target.x >= 1116 && r.target.x <= 1258 && r.target.y >= 118 && r.target.y <= 150,
        JSON.stringify(r.target));
  check("normalized fraction is right", !!r.target && Math.abs(r.target.nx - 1187 / 1280) < 1e-9);

  console.log("\n3. Retina: declared 1280x800, real viewport 2560x1600");
  r = await nextGuideStep({ ...base, declared: { width: 1280, height: 800 }, capture: { width: 2560, height: 1600 } });
  check("coordinate rescales 2x", r.target?.x === 2374 && r.target?.y === 268, JSON.stringify(r.target));

  console.log("\n4. The why-sanitizer (a leaked explanation is the one thing that can't ship)");
  for (const [why, expect, label] of [
    ["Why does this instance need a security group?", "keep", "question kept"],
    ["This creates a virtual machine.", "strip", "statement stripped"],
    ["You need a key pair because SSH requires one?", "strip", "'because' stripped even with a ?"],
    [null, "strip", "null stays null"],
    ["   ", "strip", "whitespace stripped"],
  ] as const) {
    stub([text({ observation: "o", step: "Click it.", why, status: "on_track" }), click(100, 100)]);
    const out = await nextGuideStep({ ...base, ...px });
    check(label, expect === "keep" ? out.why !== null : out.why === null, `got ${JSON.stringify(out.why)}`);
  }

  console.log("\n5. Terminal states suppress the ring");
  for (const status of ["done", "blocked"]) {
    stub([text({ observation: "o", step: "Instance is running.", why: null, status }), click(500, 400)]);
    const out = await nextGuideStep({ ...base, ...px });
    check(`${status} → no target even though a coordinate came back`, out.target === null);
    check(`${status} → status preserved`, out.status === status);
  }

  console.log("\n6. Malformed model output degrades instead of throwing");
  stub([{ type: "text", text: "```json\n{\"step\":\"Click Next.\",\"status\":\"on_track\",\"why\":\"Which subnet?\"}\n```" }, click(10, 10)]);
  r = await nextGuideStep({ ...base, ...px });
  check("fenced JSON parses", r.step === "Click Next." && r.why === "Which subnet?");

  stub([{ type: "text", text: "I can't tell what this screen is." }]);
  r = await nextGuideStep({ ...base, ...px });
  check("no JSON → fallback step, no throw", !!r.step && r.target === null);
  check("no JSON → defaults to on_track", r.status === "on_track");

  stub([click(640, 400)]);
  r = await nextGuideStep({ ...base, ...px });
  check("tool call with no text at all → still returns a target", r.target?.x === 640);

  console.log("\n7. Coordinates outside the declared box are clamped");
  stub([text({ observation: "o", step: "s", why: null, status: "on_track" }), click(5000, -20)]);
  r = await nextGuideStep({ ...base, ...px });
  check("clamped into range", r.target?.x === 1280 && r.target?.y === 0, JSON.stringify(r.target));

  console.log("\n8. Unsupported declared resolution falls back by aspect ratio");
  stub([text({ observation: "o", step: "s", why: null, status: "on_track" }), click(100, 100)]);
  await nextGuideStep({ ...base, declared: { width: 999, height: 555 }, capture: { width: 1600, height: 1000 } });
  check("declared a supported 16:10 instead of 999x555",
        lastRequest.tools[0].display_width_px === 1280 && lastRequest.tools[0].display_height_px === 800);

  console.log("\n9. History is passed through and windowed");
  stub([text({ observation: "o", step: "s", why: null, status: "on_track" }), click(1, 1)]);
  const many = Array.from({ length: 14 }, (_, i) => `Step number ${i + 1}.`);
  r = await nextGuideStep({ ...base, ...px, history: many });
  const prompt = lastRequest.messages[0].content[1].text;
  check("oldest steps dropped", !prompt.includes("Step number 1."));
  check("newest steps kept", prompt.includes("Step number 14."));
  check("index reflects full history, not the window", r.index === 14);

  console.log(`\n${"─".repeat(50)}\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
