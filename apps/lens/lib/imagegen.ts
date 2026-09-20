/**
 * LENS Scene Imagery — Nano Banana, one frame per scene.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Generates the visual for each scene of a video summary with Google's
 * image models (`gemini-2.5-flash-image` is Nano Banana; the 3.x flash
 * image models are its successors and are tried first when available).
 *
 * TWO RULES THAT DECIDE WHETHER THIS LOOKS GENERATED OR DESIGNED
 *
 * 1. NO TEXT IN THE IMAGE. Image models render lettering badly — near
 *    words, wrong words, melted words — and a deck whose slides contain
 *    convincing gibberish is worse than one with no imagery at all. Every
 *    prompt forbids text explicitly, and the real headings and on-screen
 *    lines are composited over the top by the player, where they are
 *    selectable, translatable and always spelled correctly.
 *
 * 2. ONE STYLE CONTRACT, PREPENDED TO EVERY SCENE. Generating seven
 *    images from seven independent prompts produces seven unrelated
 *    pictures. The shared preamble is what makes them read as one deck
 *    rather than a search result.
 *
 * Failure is per-scene and never fatal: a scene without an image falls
 * back to the typographic slide, which is what the player rendered before
 * imagery existed at all.
 *
 * PROVIDER ORDER
 * Nano Banana first, because it is the model this feature was designed
 * around and it is fast. OpenAI's `gpt-image-1` second, because Google's
 * free tier caps image generation *per day* — verified on this account,
 * where `GenerateRequestsPerDayPerProjectPerModel-FreeTier` was already
 * exhausted and stayed exhausted across two minutes of backoff. A daily
 * cap is not something a retry can wait out, so without a second provider
 * the feature is simply unavailable until billing is enabled. gpt-image-1
 * is slower (~33s a frame against Nano Banana's few seconds) but it works
 * on the key that is already paying for vision and reasoning.
 */

const MODELS = [
  process.env.GEMINI_IMAGE_MODEL,
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image", // Nano Banana
].filter(Boolean) as string[];

const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

/**
 * The house style. Deliberately specific — "make it look nice" produces
 * stock-photo mush, and the one thing a generated deck cannot survive is
 * looking like clip art.
 */
const STYLE = [
  "Editorial infographic illustration for a lecture slide, 16:9.",
  "Flat vector style with subtle depth. Deep navy background (#0B1220).",
  "One accent colour only: teal (#00C2A8). Everything else in cool greys.",
  "Generous negative space, composition weighted to the left third so a",
  "caption can sit on the right. Calm, precise, technical — closer to a",
  "science journal figure than to marketing art.",
  "ABSOLUTELY NO TEXT, NO WORDS, NO LETTERS, NO NUMBERS, NO LABELS anywhere",
  "in the image. Diagrams and symbols only.",
].join(" ");

export type SceneImage = {
  index: number;
  /** PNG/JPEG bytes. */
  data: Buffer;
  mimeType: string;
  model: string;
};

export function imagegenConfigured(): boolean {
  return !!(
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY
  );
}

/** Which providers are actually usable, for the UI to report honestly. */
export function imagegenProviders(): string[] {
  const out: string[] = [];
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) out.push("nano-banana");
  if (process.env.OPENAI_API_KEY) out.push("gpt-image-1");
  return out;
}

/** OpenAI's image endpoint, used when Google's daily cap is spent. */
async function openAiImage(
  prompt: string
): Promise<{ data: Buffer; mimeType: string; model: string } | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        // 3:2 — the closest this model offers to the 16:9 the slide wants.
        size: "1536x1024",
        n: 1,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return null;
    return {
      data: Buffer.from(b64, "base64"),
      mimeType: "image/png",
      model: "gpt-image-1",
    };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Google's DAILY image cap, latched for the rest of the process.
 *
 * Without this every frame pays the full Google tax before falling
 * through: measured at 114s and 77s for two frames, against gpt-image-1's
 * own ~33s. A seven-scene video spent ten minutes mostly waiting on a
 * quota that had already told us, in the first response, that it was
 * exhausted for the day. A per-day limit is not something the next frame
 * will find cleared, so the first daily 429 stops the whole run asking.
 *
 * Per-MINUTE 429s still retry normally — those genuinely do clear.
 */
let googleDailyCapUntil = 0;

function googleCapped(): boolean {
  return Date.now() < googleDailyCapUntil;
}

function latchDailyCap() {
  // Until the next UTC midnight, which is when Google's daily counters roll.
  const now = new Date();
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  googleDailyCapUntil = midnight;
  console.warn(
    "[imagegen] Google daily image quota exhausted — using the fallback provider until it resets."
  );
}

/** Google returns the retry window in the error body; honour it. */
function retryAfterMs(body: string): number | null {
  const m = body.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  return m ? Number(m[1]) * 1000 : null;
}

/**
 * One image. Walks the model list, and on a 429 waits the window Google
 * asked for rather than hammering — the free tier is per-minute, so a
 * short wait usually succeeds where an immediate retry never does.
 */
export async function generateSceneImage(input: {
  subject: string;
  /** Extra direction for this specific scene. */
  direction?: string;
  attempts?: number;
}): Promise<{ data: Buffer; mimeType: string; model: string } | null> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  const prompt = [
    STYLE,
    "",
    `Subject: ${input.subject}`,
    input.direction ? `Composition: ${input.direction}` : "",
    "",
    "Remember: no text of any kind in the image.",
  ]
    .filter(Boolean)
    .join("\n");

  const maxAttempts = input.attempts ?? 2;

  // No Google key, or its daily cap is already spent: skip straight to the
  // fallback rather than paying the retry cost again on every scene.
  if (!key || googleCapped()) return openAiImage(prompt);

  for (const model of MODELS) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const res = await fetch(ENDPOINT(model, key), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (res.status === 429) {
          const body = await res.text().catch(() => "");

          // A per-day violation will not clear by waiting. Latch it and
          // stop asking — for this model and for every scene after it.
          if (/PerDay/i.test(body)) {
            latchDailyCap();
            return openAiImage(prompt);
          }

          const wait = retryAfterMs(body);
          // Only wait when there is another attempt to spend it on.
          if (wait && attempt < maxAttempts - 1) {
            await sleep(Math.min(wait + 1000, 40_000));
            continue;
          }
          break; // try the next model
        }

        if (!res.ok) break;

        const json = (await res.json()) as any;
        const parts = json?.candidates?.[0]?.content?.parts ?? [];
        const inline = parts.find((p: any) => p?.inlineData || p?.inline_data);
        const blob = inline?.inlineData || inline?.inline_data;
        if (!blob?.data) break;

        return {
          data: Buffer.from(blob.data, "base64"),
          mimeType: String(blob.mimeType || blob.mime_type || "image/png"),
          model,
        };
      } catch {
        break; // network/timeout — move to the next model
      }
    }
  }

  // Every Google model refused or was capped. Fall through to OpenAI.
  return openAiImage(prompt);
}

/**
 * Imagery for a whole storyboard.
 *
 * Sequential, not parallel — the opposite of the narration path, and for a
 * concrete reason: image generation is the rate-limited call here, and
 * firing seven at once against a per-minute free-tier quota guarantees
 * most of them 429. One at a time with a small gap gets more usable frames
 * back than a burst does, even though it takes longer.
 */
export async function generateStoryboardImages(
  scenes: { keyTerm?: string; heading: string; narration: string; visualPrompt?: string }[],
  opts: { limit?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<(SceneImage | null)[]> {
  const limit = Math.min(scenes.length, opts.limit ?? 8);
  const out: (SceneImage | null)[] = [];

  for (let i = 0; i < limit; i += 1) {
    const scene = scenes[i];
    const subject =
      scene.visualPrompt?.trim() ||
      `${scene.keyTerm || scene.heading}. ${scene.narration}`.slice(0, 400);

    const image = await generateSceneImage({
      subject,
      direction:
        i === 0
          ? "Opening frame — a wide establishing composition."
          : "Keep the same palette and line weight as the previous frames.",
    });

    out.push(image ? { index: i, ...image } : null);
    opts.onProgress?.(i + 1, limit);

    // A breath between calls. Cheaper than a 429 and the retry behind it.
    if (i < limit - 1) await sleep(600);
  }

  return out;
}
