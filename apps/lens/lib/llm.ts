/**
 * Unified LLM provider — Google Gemini/Gemma primary, OpenAI fallback.
 * ────────────────────────────────────────────────────────────────────
 * Why this exists: the rest of the codebase wrote OpenAI-specific calls
 * inline. This module hides the provider so every feature gets:
 *   1. Gemma 3 (Google's open model, free tier on Gemini API) as primary
 *   2. Automatic fallback to OpenAI when Gemini is missing/erroring
 *   3. One JSON helper, one streaming helper, no per-call branching
 *
 * Env vars (all optional):
 *   GOOGLE_API_KEY            — Google AI Studio key (alias: GEMINI_API_KEY)
 *   GEMINI_MODEL              — default "gemma-4-26b-a4b-it". Supported Gemma 4 IDs
 *                                on the Gemini API are "gemma-4-31b-it" and
 *                                "gemma-4-26b-a4b-it". Other Gemma 4 strings 404.
 *   GEMINI_FALLBACK_MODEL     — used if primary model unsupported, default "gemini-2.5-flash"
 *   LLM_PRIMARY               — "gemini" | "openai", default "gemini"
 *   OPENAI_API_KEY / OPENAI_MODEL_CHAT / OPENAI_MODEL_GEN — fallback path
 */

import OpenAI from "openai";
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";

// ── Config ────────────────────────────────────────────────────────────
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemma-4-26b-a4b-it";
const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";
const PRIMARY = (process.env.LLM_PRIMARY || "gemini").toLowerCase();

const OPENAI_MODEL_CHAT = process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini";
const OPENAI_MODEL_GEN = process.env.OPENAI_MODEL_GEN || "gpt-4o-mini";

// ── Lazy clients ──────────────────────────────────────────────────────
let _gemini: GoogleGenerativeAI | null = null;
function getGemini(): GoogleGenerativeAI | null {
  if (_gemini) return _gemini;
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null;
  _gemini = new GoogleGenerativeAI(key);
  return _gemini;
}

let _openai: OpenAI | null = null;
function getOpenAIClient(): OpenAI | null {
  if (_openai) return _openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  _openai = new OpenAI({ apiKey: key });
  return _openai;
}

// Provider availability — used to decide order
function geminiAvailable(): boolean {
  return !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
}
function openaiAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ── Public types ──────────────────────────────────────────────────────
export type LlmRole = "user" | "assistant";
export type LlmMessage = { role: LlmRole; text: string };

export type LlmJsonOpts = {
  /** Sampling temperature (default 0.4) */
  temperature?: number;
  /** Hard cap on output tokens (Gemini supports it; OpenAI uses max_tokens) */
  maxTokens?: number;
  /** Force a specific provider for this call */
  provider?: "gemini" | "openai";
  /**
   * Gemma 4 reasoning toggle. "high" enables the model's internal
   * thinking process for stronger multi-step reasoning (slower, higher
   * token usage). Use for canvas/quiz/concept-map. Defaults to env
   * GEMMA_THINKING (or off).
   */
  thinking?: "high" | "off";
};

export type LlmStreamOpts = LlmJsonOpts;

// ── JSON completion (multi-provider, with fallback) ───────────────────
export async function llmJson<T>(
  system: string,
  user: string,
  opts: LlmJsonOpts = {}
): Promise<T> {
  const order = providerOrder(opts.provider);
  let lastErr: any = null;
  for (const p of order) {
    try {
      const text =
        p === "gemini"
          ? await geminiJsonText(system, user, opts)
          : await openaiJsonText(system, user, opts);
      return parseJson<T>(text);
    } catch (err) {
      lastErr = err;
      // Continue to next provider
      if (process.env.LLM_DEBUG) console.warn(`[llm.json:${p}]`, err);
    }
  }
  throw new Error(
    "All LLM providers failed. " +
      (lastErr?.message || "Set GOOGLE_API_KEY or OPENAI_API_KEY in .env.local.")
  );
}

// ── Streaming chat (multi-provider, with fallback) ────────────────────
/**
 * Yields plain-text deltas as they arrive. Provider-agnostic.
 * Falls back from Gemini → OpenAI on initial error only (mid-stream
 * errors propagate to the caller; we cannot replay deltas).
 */
export async function* llmStream(
  system: string,
  history: LlmMessage[],
  userMsg: string,
  opts: LlmStreamOpts = {}
): AsyncGenerator<string, void, unknown> {
  const order = providerOrder(opts.provider);
  let started = false;
  let lastErr: any = null;
  for (const p of order) {
    try {
      const it =
        p === "gemini"
          ? geminiStream(system, history, userMsg, opts)
          : openaiStream(system, history, userMsg, opts);
      for await (const delta of it) {
        started = true;
        if (delta) yield delta;
      }
      return;
    } catch (err) {
      lastErr = err;
      if (started) throw err; // can't replay; surface to caller
      if (process.env.LLM_DEBUG) console.warn(`[llm.stream:${p}]`, err);
    }
  }
  throw new Error(
    "All LLM providers failed. " +
      (lastErr?.message || "Set GOOGLE_API_KEY or OPENAI_API_KEY in .env.local.")
  );
}

// ── Provider order (respects LLM_PRIMARY + availability) ──────────────
function providerOrder(forced?: "gemini" | "openai"): ("gemini" | "openai")[] {
  if (forced) return [forced];
  const list: ("gemini" | "openai")[] = [];
  const primary: "gemini" | "openai" = PRIMARY === "openai" ? "openai" : "gemini";
  const secondary: "gemini" | "openai" = primary === "gemini" ? "openai" : "gemini";
  if (primary === "gemini" ? geminiAvailable() : openaiAvailable()) list.push(primary);
  if (secondary === "gemini" ? geminiAvailable() : openaiAvailable())
    list.push(secondary);
  // If neither key is set, still try Gemini (it'll throw a clean error)
  if (list.length === 0) list.push("gemini");
  return list;
}

// ── Gemini / Gemma 4 implementation ───────────────────────────────────
type GeminiCall = (modelName: string) => Promise<string>;

function isGemma(modelName: string): boolean {
  return /gemma/i.test(modelName);
}

/**
 * Build a generationConfig that's safe for both Gemma 4 and Gemini.
 * - JSON mime type is only set for Gemini (Gemma rejects it).
 * - Gemma 4 thinking config is only set when explicitly requested or
 *   when GEMMA_THINKING env is set; Gemini's thinking config is separate.
 */
function buildGenerationConfig(
  modelName: string,
  opts: { temperature?: number; maxTokens?: number; thinking?: "high" | "off"; json?: boolean }
) {
  const cfg: any = {
    temperature: opts.temperature ?? 0.4,
    maxOutputTokens: opts.maxTokens ?? 4096,
  };
  if (opts.json && !isGemma(modelName)) {
    cfg.responseMimeType = "application/json";
  }
  // Gemma 4 thinking: per Google docs, only `"high"` is a documented level.
  // Sending `thinkingLevel: "off"` returns 400 — simply omit the config to
  // disable thinking. We also only attach this for Gemma models; Gemini's
  // thinking config has a different shape.
  // If caller explicitly passes "off", that always wins over the env default.
  const DEFAULT_THINKING = (process.env.GEMMA_THINKING || "").toLowerCase();
  const thinking =
    opts.thinking === "off"
      ? "off"
      : opts.thinking ?? (DEFAULT_THINKING === "high" ? "high" : undefined);
  if (isGemma(modelName) && thinking === "high") {
    cfg.thinkingConfig = { thinkingLevel: "high" };
  }
  return cfg;
}

/**
 * Try the configured model first; on "unsupported" errors retry once on
 * GEMINI_FALLBACK_MODEL. Catches: model unavailable, unknown field,
 * unsupported response_mime_type, unsupported thinking config, etc.
 */
async function geminiWithModelFallback(call: GeminiCall): Promise<string> {
  try {
    return await call(GEMINI_MODEL);
  } catch (err: any) {
    const msg = String(err?.message || "");
    const looksUnsupported =
      /not.*support|unsupported|unknown field|invalid.*model|404|response_mime_type|thinking/i.test(
        msg
      );
    if (looksUnsupported && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
      if (process.env.LLM_DEBUG)
        console.warn(`[llm.gemini] retrying on ${GEMINI_FALLBACK_MODEL}:`, msg);
      return await call(GEMINI_FALLBACK_MODEL);
    }
    throw err;
  }
}

async function geminiJsonText(
  system: string,
  user: string,
  opts: LlmJsonOpts
): Promise<string> {
  const client = getGemini();
  if (!client) throw new Error("Gemini not configured (GOOGLE_API_KEY missing)");

  // Gemma 4 supports systemInstruction natively (per Google docs). It does
  // NOT support responseMimeType, so we always append a strict suffix and
  // parse defensively (handles fenced output too).
  const systemPlus =
    system +
    `\n\nIMPORTANT: Respond with a single JSON object only. No prose, no code fences, no commentary.`;

  return geminiWithModelFallback(async (modelName) => {
    const generationConfig = buildGenerationConfig(modelName, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      thinking: opts.thinking,
      json: true,
    });
    const model: GenerativeModel = client.getGenerativeModel({
      model: modelName,
      generationConfig,
      systemInstruction: systemPlus,
    });

    const res = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
    });
    const text = res.response.text();
    if (!text) throw new Error("Empty Gemini response");
    return text;
  });
}

async function* geminiStream(
  system: string,
  history: LlmMessage[],
  userMsg: string,
  opts: LlmStreamOpts
): AsyncGenerator<string, void, unknown> {
  const client = getGemini();
  if (!client) throw new Error("Gemini not configured (GOOGLE_API_KEY missing)");

  const generationConfig = buildGenerationConfig(GEMINI_MODEL, {
    temperature: opts.temperature ?? 0.5,
    maxTokens: opts.maxTokens ?? 2048,
    thinking: opts.thinking,
    json: false,
  });
  const model: GenerativeModel = client.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig,
    systemInstruction: system,
  });

  // Gemini chat API expects role "model" for assistant turns.
  const contents: any[] = [];
  for (const m of history) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }],
    });
  }
  contents.push({ role: "user", parts: [{ text: userMsg }] });

  const result = await model.generateContentStream({ contents });
  for await (const chunk of result.stream) {
    // Filter out thought/reasoning parts — Gemma 4 thinking tokens come
    // through as parts with `thought: true` and must be suppressed so the
    // user never sees the internal reasoning process.
    const parts = (chunk as any).candidates?.[0]?.content?.parts as any[] | undefined;
    if (parts?.length) {
      for (const part of parts) {
        if (!part.thought && part.text) yield part.text as string;
      }
    } else {
      const text = chunk.text();
      if (text) yield text;
    }
  }
}

// ── OpenAI implementation ─────────────────────────────────────────────
async function openaiJsonText(
  system: string,
  user: string,
  opts: LlmJsonOpts
): Promise<string> {
  const client = getOpenAIClient();
  if (!client) throw new Error("OpenAI not configured (OPENAI_API_KEY missing)");
  const res = await client.chat.completions.create({
    model: OPENAI_MODEL_GEN,
    response_format: { type: "json_object" },
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty OpenAI response");
  return text;
}

async function* openaiStream(
  system: string,
  history: LlmMessage[],
  userMsg: string,
  opts: LlmStreamOpts
): AsyncGenerator<string, void, unknown> {
  const client = getOpenAIClient();
  if (!client) throw new Error("OpenAI not configured (OPENAI_API_KEY missing)");
  const messages: any[] = [{ role: "system", content: system }];
  for (const m of history) messages.push({ role: m.role, content: m.text });
  messages.push({ role: "user", content: userMsg });

  const stream = await client.chat.completions.create({
    model: OPENAI_MODEL_CHAT,
    temperature: opts.temperature ?? 0.5,
    stream: true,
    messages,
  });
  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content || "";
    if (delta) yield delta;
  }
}

// ── JSON parsing (with cheap repair) ──────────────────────────────────
function parseJson<T>(text: string): T {
  const cleaned = stripJsonFences(text).trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract the largest {...} or [...] block
    const m = cleaned.match(/[\{\[][\s\S]*[\}\]]/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* fall through */
      }
    }
    throw new Error("LLM returned invalid JSON: " + cleaned.slice(0, 240));
  }
}

function stripJsonFences(text: string): string {
  // Remove ```json ... ``` or ``` ... ``` wrappers if present
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
}

// ── Diagnostics (optional helper) ─────────────────────────────────────
export function llmStatus() {
  return {
    primary: PRIMARY,
    geminiModel: GEMINI_MODEL,
    geminiFallbackModel: GEMINI_FALLBACK_MODEL,
    geminiConfigured: geminiAvailable(),
    openaiConfigured: openaiAvailable(),
    openaiChatModel: OPENAI_MODEL_CHAT,
    openaiGenModel: OPENAI_MODEL_GEN,
  };
}
