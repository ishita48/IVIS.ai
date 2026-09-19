/**
 * Create or update the LENS agent on ElevenLabs.
 *
 *   node scripts/lens-agent.mjs
 *
 * The system prompt is NOT duplicated here — it is read out of the first
 * ```text block in ELEVENLABS_AGENT.md, so that file stays the single source
 * of truth. Edit the prompt there, re-run this, and the agent updates.
 *
 * Creates the three client tools first, then the agent referencing them.
 * If NEXT_PUBLIC_ELEVENLABS_AGENT_ID is already set, the agent is updated in
 * place rather than duplicated.
 */

import fs from "node:fs";

const API = "https://api.elevenlabs.io/v1";
const ENV = ".env.local";
const DOC = "ELEVENLABS_AGENT.md";

// ── env ───────────────────────────────────────────────────────────────
const envText = fs.readFileSync(ENV, "utf8");
const readEnv = (key) => {
  const m = envText.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "") : "";
};

const apiKey = readEnv("ELEVENLABS_API_KEY");
if (!apiKey) throw new Error(`ELEVENLABS_API_KEY is empty in ${ENV}`);
const existingAgentId = readEnv("NEXT_PUBLIC_ELEVENLABS_AGENT_ID");

// ── prompt + first message, lifted from the doc ───────────────────────
const doc = fs.readFileSync(DOC, "utf8");
const blocks = [...doc.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1].trim());
if (blocks.length < 2) throw new Error(`Expected 2 text blocks in ${DOC}, found ${blocks.length}`);
const [systemPrompt, firstMessage] = blocks;

// ── tools ─────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "client",
    name: "analyze_workspace",
    description:
      "Look at the student's workspace right now. Captures a single frame from their camera and returns what is visible, plus a box drawn on their screen around the thing worth attention. This is your only way to see. Returns observation (what is there), objects, confidence (0-1; below 0.3 means the frame could not be read), and changed (whether it differs from your last look).",
    // Load-bearing: without this the agent speaks before the frame comes back
    // and describes a workspace it has not seen.
    expects_response: true,
    response_timeout_secs: 20,
    parameters: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description:
            "What you are trying to find out by looking, e.g. 'check whether the component the student just moved is oriented differently now'. Be specific.",
        },
      },
      required: ["objective"],
    },
  },
  {
    type: "client",
    name: "compare_to_reference",
    description:
      "Compare the student's camera to the reference video they loaded. Captures one frame from each and returns the single largest physical difference, plus a box on each. Only works when a reference video is loaded — the result says so if not. Use when the student is working from a reference and asks how they are doing, or when you want to see the gap for yourself. The reference is NOT automatically correct; it is just the other image.",
    expects_response: true,
    response_timeout_secs: 25,
    parameters: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description:
            "What you are trying to compare, e.g. 'check the height and angle of the kicking leg against the reference'. Be specific about the body part or object.",
        },
      },
      required: ["objective"],
    },
  },
  {
    type: "client",
    name: "note_misconception",
    description:
      "Record a belief or habit that keeps producing the same gap, along with what would address it underneath. Call when you have seen the same issue more than once and can name what is really causing it. This is the most valuable thing you produce — it appears in the end-of-session summary.",
    expects_response: false,
    parameters: {
      type: "object",
      properties: {
        belief: {
          type: "string",
          description:
            "What the student appears to believe or habitually do, in plain words, non-judgementally. e.g. 'that height comes from kicking harder'.",
        },
        rootCause: {
          type: "string",
          description:
            "What is actually producing it, at concept level. e.g. 'height comes from hip mobility, not force'. Never the specific correction for this attempt.",
        },
        practice: {
          type: "string",
          description:
            "One thing to work on over time, not a fix to apply right now. e.g. 'hip flexor mobility work'.",
        },
      },
      required: ["belief", "rootCause", "practice"],
    },
  },
  {
    type: "client",
    name: "set_mode",
    description:
      "Switch how you teach. Call when the student asks you to explain more, ask fewer questions, back off, or work it out themselves.",
    expects_response: false,
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description:
            "One of: socratic (point and ask), guided (name the concept, suggest one thing to try), explain (teach the concept properly, mostly without questions).",
        },
      },
      required: ["mode"],
    },
  },
  {
    type: "client",
    name: "note_understanding",
    description:
      "Record how well the student currently grasps what you are working on. Call whenever your read of their understanding changes — after they answer, predict, or try something. Drives the end-of-session summary.",
    expects_response: false,
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Short label for what is being understood, e.g. 'earbud charging contacts'.",
        },
        level: {
          type: "number",
          description: "0 to 1. 0 = no grasp, 0.5 = partial or shaky, 1 = solid and can explain it back.",
        },
        why: {
          type: "string",
          description: "One short sentence of evidence, in the student's words where possible.",
        },
      },
      required: ["topic", "level", "why"],
    },
  },
  {
    type: "client",
    name: "set_pace",
    description:
      "Adjust how fast you go. Call when the student asks you to slow down, speed up, or repeat yourself.",
    expects_response: false,
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          description: "One of: slower, normal, repeat.",
        },
      },
      required: ["mode"],
    },
  },
  {
    type: "client",
    name: "record_prediction",
    description:
      "Log what the student said they expect to happen, before they try it. Call this immediately after they answer a prediction question.",
    expects_response: false,
    parameters: {
      type: "object",
      properties: {
        prediction: {
          type: "string",
          description: "What the student said they expect, in their own words.",
        },
      },
      required: ["prediction"],
    },
  },
];

async function call(path, method, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}\n${text.slice(0, 1200)}`);
  return text ? JSON.parse(text) : {};
}

// Reuse tools of the same name rather than piling up duplicates on re-runs.
const existingTools = await call("/convai/tools", "GET").catch(() => ({ tools: [] }));
const byName = new Map(
  (existingTools.tools ?? []).map((t) => [t.tool_config?.name ?? t.name, t.id ?? t.tool_id])
);

const toolIds = [];
for (const tool_config of TOOLS) {
  const existing = byName.get(tool_config.name);
  if (existing) {
    await call(`/convai/tools/${existing}`, "PATCH", { tool_config });
    toolIds.push(existing);
    console.log(`  updated tool  ${tool_config.name}  (${existing})`);
  } else {
    const created = await call("/convai/tools", "POST", { tool_config });
    const id = created.id ?? created.tool_id;
    toolIds.push(id);
    console.log(`  created tool  ${tool_config.name}  (${id})`);
  }
}

// ── agent ─────────────────────────────────────────────────────────────
const conversation_config = {
  agent: {
    first_message: firstMessage,
    language: "en",
    prompt: {
      prompt: systemPrompt,
      // gpt-4o-mini leaks answers and skips rungs. The pedagogy IS the
      // product, so pay for the instruction following.
      llm: "gpt-4o",
      temperature: 0.4,
      tool_ids: toolIds,
    },
  },
  tts: {
    voice_id: "XrExE9yKIg1WjnnlVkGX", // Matilda — knowledgable, professional
    model_id: "eleven_turbo_v2",
    stability: 0.5,
    similarity_boost: 0.75,
    speed: 0.95,
  },
  turn: {
    // Long, so silence while they actually work is not read as end-of-turn.
    turn_timeout: 10,
    turn_eagerness: "normal",
  },
};

let agentId = existingAgentId;
if (agentId) {
  await call(`/convai/agents/${agentId}`, "PATCH", { name: "LENS", conversation_config });
  console.log(`\n  updated agent LENS  (${agentId})`);
} else {
  const created = await call("/convai/agents/create", "POST", { name: "LENS", conversation_config });
  agentId = created.agent_id;
  console.log(`\n  created agent LENS  (${agentId})`);

  const next = envText.replace(
    /^NEXT_PUBLIC_ELEVENLABS_AGENT_ID=.*$/m,
    `NEXT_PUBLIC_ELEVENLABS_AGENT_ID=${agentId}`
  );
  fs.writeFileSync(ENV, next);
  console.log(`  wrote NEXT_PUBLIC_ELEVENLABS_AGENT_ID into ${ENV}`);
}

console.log("\n  Restart next dev so the new env var is picked up.");
