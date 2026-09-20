/**
 * LENS Scene Motion — a short clip per scene, not a still.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Stills made the "video summary" an infographic slideshow. This generates
 * a real moving clip for each scene with Sora, so the gear actually turns.
 *
 * THE ONE THING THAT MAKES THIS FAST ENOUGH TO USE
 * Sora is an async job API: create, poll, download. A single 4-second clip
 * took ~50s end to end when measured. Done one scene after another, a
 * seven-scene summary is six minutes and nobody waits for that.
 *
 * So every job is created FIRST, in one burst, and only then polled
 * together. Seven clips finish in roughly the time of the slowest one —
 * about a minute — instead of the sum of all seven. That is the whole
 * reason this module is shaped around a job list rather than a loop with
 * an await in it.
 *
 * SHORT CLIPS ON PURPOSE
 * Four seconds is the floor Sora offers and it is the right choice twice
 * over: it is the cheapest and fastest thing to generate, and short clips
 * splice together far more cheaply than long ones. A scene only has to
 * hold the screen for as long as its sentence takes to say, and when the
 * narration runs longer the player loops the clip rather than paying for
 * video nobody is watching.
 *
 * COST
 * This is by far the most expensive call in the product — orders of
 * magnitude above a vision call. It is opt-in in the UI for that reason,
 * and `MAX_CLIPS` is a hard ceiling rather than a suggestion.
 */

const SORA_MODEL = process.env.SORA_MODEL || "sora-2";
const MAX_CLIPS = 8;
const POLL_MS = 6_000;
const POLL_TIMEOUT_MS = 240_000;

/** House style, shared by every clip so the deck looks like one piece. */
const STYLE = [
  "Flat vector infographic animation on a deep navy background.",
  "One accent colour only: teal. Everything else in cool greys.",
  "Slow, deliberate, technical motion — a diagram coming to life, not a",
  "camera move. Locked-off framing, generous negative space.",
  "NO TEXT, NO WORDS, NO LETTERS, NO NUMBERS anywhere in the frame.",
].join(" ");

export type SceneClip = {
  index: number;
  data: Buffer;
  mimeType: string;
  model: string;
  seconds: number;
};

export function videogenConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Job = { index: number; id: string | null; error?: string };

function buildPrompt(subject: string, direction?: string): string {
  return [STYLE, "", `Subject: ${subject}`, direction ? `Motion: ${direction}` : "", "", "Remember: no text of any kind."]
    .filter(Boolean)
    .join("\n");
}

/** Kick off one job. Returns its id, or the reason it could not start. */
async function createJob(
  prompt: string,
  seconds: number,
  key: string
): Promise<{ id: string | null; error?: string }> {
  try {
    const res = await fetch("https://api.openai.com/v1/videos", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: SORA_MODEL,
        prompt,
        seconds: String(seconds),
        size: "1280x720",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json()) as any;
    if (!res.ok || !json?.id) {
      return { id: null, error: json?.error?.message?.slice(0, 160) || `HTTP ${res.status}` };
    }
    return { id: String(json.id) };
  } catch (error) {
    return { id: null, error: (error as Error).message.slice(0, 160) };
  }
}

async function pollJob(id: string, key: string): Promise<"completed" | "failed" | "timeout"> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    try {
      const res = await fetch(`https://api.openai.com/v1/videos/${id}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(30_000),
      });
      const json = (await res.json()) as any;
      const status = String(json?.status || "");
      if (status === "completed") return "completed";
      if (status === "failed" || status === "cancelled") return "failed";
    } catch {
      // A transient poll failure is not a job failure; keep waiting.
    }
  }
  return "timeout";
}

async function download(id: string, key: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`https://api.openai.com/v1/videos/${id}/content`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // An MP4 starts with a `ftyp` box at offset 4. Anything else is an
    // error page that happened to arrive with a 200.
    if (buf.length < 1024 || buf.subarray(4, 8).toString("latin1") !== "ftyp") return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Clips for a whole storyboard.
 *
 * Create every job, then poll them together. `onProgress` fires as each
 * one lands so the UI can count up rather than sitting on a spinner for a
 * minute with nothing to say.
 */
export async function generateSceneClips(
  scenes: { keyTerm?: string; heading?: string; narration: string; visualPrompt?: string }[],
  opts: {
    seconds?: number;
    limit?: number;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<(SceneClip | null)[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return scenes.map(() => null);

  const seconds = opts.seconds ?? 4;
  const limit = Math.min(scenes.length, opts.limit ?? MAX_CLIPS);
  const wanted = scenes.slice(0, limit);

  // ── 1. Start everything at once ──────────────────────────────
  const jobs: Job[] = await Promise.all(
    wanted.map(async (scene, index): Promise<Job> => {
      const subject =
        scene.visualPrompt?.trim() ||
        `${scene.keyTerm || scene.heading || ""}. ${scene.narration}`.slice(0, 380);
      const direction =
        index === 0
          ? "Opening shot — the subject assembling or settling into place."
          : "Continue the same visual language as the previous clip.";
      const { id, error } = await createJob(buildPrompt(subject, direction), seconds, key);
      return { index, id, error };
    })
  );

  // ── 2. Wait on them together ─────────────────────────────────
  let done = 0;
  const total = jobs.filter((j) => j.id).length;

  const results = await Promise.all(
    jobs.map(async (job): Promise<SceneClip | null> => {
      if (!job.id) return null;
      const status = await pollJob(job.id, key);
      if (status !== "completed") {
        done += 1;
        opts.onProgress?.(done, total);
        return null;
      }
      const data = await download(job.id, key);
      done += 1;
      opts.onProgress?.(done, total);
      if (!data) return null;
      return {
        index: job.index,
        data,
        mimeType: "video/mp4",
        model: SORA_MODEL,
        seconds,
      };
    })
  );

  return results;
}
