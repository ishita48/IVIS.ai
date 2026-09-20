/**
 * Cloudinary — narration hosting, optional by design.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Signed REST rather than the `cloudinary` npm package. The SDK is a
 * dependency, a bundle, and a version to keep working; the upload endpoint
 * is one POST and a SHA-1, and Node already has both. Nothing else in the
 * app needs Cloudinary, so a whole SDK for one call is not a trade worth
 * making at this size.
 *
 * EVERY FUNCTION HERE IS OPTIONAL. When the credentials are absent,
 * `upload` returns null and the caller streams the audio it already has in
 * memory. That is the difference between "Cloudinary makes this faster on
 * the second play" and "the video feature is broken because a key is
 * missing" — and on venue Wi-Fi the second one is how a demo dies.
 */

import crypto from "node:crypto";

/**
 * Trimmed, because a pasted credential brings its whitespace with it.
 *
 * CLOUDINARY_API_KEY once held the right digits with a leading space.
 * Cloudinary answered "Invalid api_key", which reads like the wrong
 * account and sent the search in the wrong direction for a long time. A
 * key that is correct apart from a space nobody can see in a file should
 * not cost anyone that.
 *
 * Dotenv strips surrounding quotes but keeps whitespace inside them, so
 * this is the only place it can be caught.
 */
const env = (name: string) => (process.env[name] ?? "").trim();

const CLOUD = () => env("CLOUDINARY_CLOUD_NAME");
const KEY = () => env("CLOUDINARY_API_KEY");
const SECRET = () => env("CLOUDINARY_API_SECRET");

export function cloudinaryConfigured(): boolean {
  return !!(CLOUD() && KEY() && SECRET());
}

/**
 * Cloudinary's api_key is numeric and its api_secret is not, so pasting
 * them into the wrong variables is both easy and invisible — the upload
 * just 401s with "Invalid api_key <your secret>", which reads like a bad
 * account rather than a swapped pair. Checked here so the error names the
 * actual problem.
 */
export function cloudinaryCredentialProblem(): string | null {
  if (!cloudinaryConfigured()) return null;
  if (!/^\d+$/.test(KEY())) {
    return "CLOUDINARY_API_KEY should be the numeric key from your Cloudinary dashboard — the value set looks like the API secret.";
  }
  if (KEY() === SECRET()) {
    return "CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are the same value; they are two different credentials.";
  }
  return null;
}

/**
 * Prove all three credentials at once against the Admin API.
 *
 * The shape checks above catch a swapped key/secret, but they cannot catch
 * a wrong cloud_name — that is just a string, and a plausible-looking one
 * ("lens") fails with `Invalid cloud_name`, which is easy to read as a
 * network problem. This asks Cloudinary directly.
 */
export async function cloudinaryPing(): Promise<{ ok: boolean; detail: string }> {
  const shape = cloudinaryCredentialProblem();
  if (shape) return { ok: false, detail: shape };
  if (!cloudinaryConfigured()) {
    return { ok: false, detail: "Cloudinary is not configured (cloud name, key or secret is blank)." };
  }
  try {
    const auth = Buffer.from(`${KEY()}:${SECRET()}`).toString("base64");
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD()}/usage`, {
      headers: { authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { ok: true, detail: `cloud "${CLOUD()}" authenticated` };
    const body = await res.text().catch(() => "");
    if (/Invalid cloud_name/i.test(body)) {
      return {
        ok: false,
        detail: `CLOUDINARY_CLOUD_NAME="${CLOUD()}" is not a real cloud. It is your account's unique name from the Cloudinary dashboard (top-left, or the middle part of CLOUDINARY_URL=cloudinary://key:secret@THIS). It is usually not a word you chose.`,
      };
    }
    if (/cloud_name mismatch/i.test(body)) {
      return {
        ok: false,
        detail: `CLOUDINARY_CLOUD_NAME="${CLOUD()}" does not match the account this key/secret belongs to. The key and secret are fine — only the cloud name is wrong. Find it on cloudinary.com → Dashboard: it is the "Cloud name" field, and also the part after the @ in CLOUDINARY_URL=cloudinary://key:secret@THIS.`,
      };
    }
    if (res.status === 401) {
      return { ok: false, detail: `Cloudinary rejected the key/secret pair: ${body.slice(0, 140)}` };
    }
    return { ok: false, detail: `Cloudinary returned ${res.status}: ${body.slice(0, 140)}` };
  } catch (error) {
    return { ok: false, detail: `Could not reach Cloudinary: ${(error as Error).message}` };
  }
}

/**
 * Cloudinary's signature is SHA-1 over the parameters you send, sorted by
 * key, joined `k=v` with `&`, with the api_secret appended raw. `file`,
 * `api_key`, `resource_type` and `cloud_name` are excluded — signing them
 * produces a 401 that reads like a bad secret.
 */
function sign(params: Record<string, string>): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(canonical + SECRET()).digest("hex");
}

export type UploadResult = {
  url: string;
  publicId: string;
  bytes: number;
  /** Cloudinary reports audio duration in seconds — useful for timing. */
  durationSec: number | null;
};

/**
 * Upload an audio buffer. Audio goes in under `resource_type: video` —
 * Cloudinary has no separate audio type, and `raw` would skip the
 * transcoding and duration probe that make the result useful here.
 *
 * Returns null rather than throwing when unconfigured or on failure: the
 * caller always has the bytes already and can serve them directly.
 */
export async function uploadAudio(
  audio: Buffer,
  opts: { publicId: string; folder?: string; contentType?: string }
): Promise<UploadResult | null> {
  if (!cloudinaryConfigured()) return null;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder = opts.folder ?? "lens/narration";

  // Overwriting on the same public_id means replaying a scene reuses one
  // asset instead of littering the account with a copy per play.
  const signed: Record<string, string> = {
    folder,
    overwrite: "true",
    public_id: opts.publicId,
    timestamp,
  };

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(audio)], { type: opts.contentType || "audio/mpeg" })
  );
  form.append("api_key", KEY());
  for (const [k, v] of Object.entries(signed)) form.append(k, v);
  form.append("signature", sign(signed));

  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD()}/video/upload`,
      { method: "POST", body: form, signal: AbortSignal.timeout(30_000) }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(
        `[cloudinary] upload failed (${res.status}): ${detail.slice(0, 160)}`
      );
      return null;
    }

    const json = (await res.json()) as {
      secure_url?: string;
      public_id?: string;
      bytes?: number;
      duration?: number;
    };

    if (!json.secure_url) return null;

    return {
      url: json.secure_url,
      publicId: String(json.public_id || opts.publicId),
      bytes: Number(json.bytes) || audio.length,
      durationSec: Number.isFinite(json.duration) ? Number(json.duration) : null,
    };
  } catch (error) {
    console.warn("[cloudinary] upload error:", (error as Error).message);
    return null;
  }
}

/** Stable id for a scene's narration, so identical text is uploaded once. */
export function narrationId(sessionId: string, sceneIndex: number, text: string): string {
  const digest = crypto
    .createHash("sha1")
    .update(text.trim().toLowerCase())
    .digest("hex")
    .slice(0, 12);
  return `${sessionId || "anon"}-s${sceneIndex}-${digest}`;
}


// ─────────────────────────────────────────────────────────────────────
// Stitching
// ─────────────────────────────────────────────────────────────────────
/**
 * UNVERIFIED AGAINST A LIVE ACCOUNT. Everything below is written from
 * Cloudinary's upload/slideshow API and has NOT been run — the credentials
 * were empty when it was written, so there was no account to run it
 * against. Treat the first execution as the real test, and check the
 * returned `secure_url` plays before putting it in front of anyone.
 *
 * The rest of this module is different: `uploadAudio` degrades to null and
 * the caller carries on. Stitching cannot degrade — either there is an MP4
 * or there is not — so it returns null loudly rather than pretending.
 */

export type StitchInput = {
  /** Cloudinary public ids of the scene images, in order. */
  imagePublicIds: string[];
  /** Public id of the narration audio to lay over the whole thing. */
  audioPublicId?: string | null;
  /** Seconds each slide holds. Should match that scene's narration length. */
  slideDurations?: number[];
  publicId: string;
};

/**
 * Build one MP4 from the scene images, with the narration over the top.
 *
 * Cloudinary's slideshow takes a manifest describing the slides and the
 * transitions; durations are in milliseconds. Per-slide timing matters
 * here rather than a fixed `sdur`, because a slide should hold exactly as
 * long as its own sentence takes to say — a uniform 3s per scene is how a
 * narrated deck ends up out of sync by the third slide.
 */
export async function stitchSlideshow(
  input: StitchInput
): Promise<UploadResult | null> {
  if (!cloudinaryConfigured()) return null;
  if (!input.imagePublicIds.length) return null;

  const slides = input.imagePublicIds.map((id, i) => ({
    media: `i:${id.replace(/\//g, ":")}`,
    ...(input.slideDurations?.[i]
      ? { sdur: Math.round(input.slideDurations[i] * 1000) }
      : {}),
  }));

  const manifest = {
    w: 1280,
    h: 720,
    vars: {
      sdur: 4000,
      tdur: 700,
      slides,
    },
  };

  const timestamp = Math.floor(Date.now() / 1000).toString();

  // The narration is laid over the finished slideshow as an audio layer.
  const transformation = input.audioPublicId
    ? `l_audio:${input.audioPublicId.replace(/\//g, ":")}/fl_layer_apply`
    : undefined;

  const signed: Record<string, string> = {
    manifest_json: JSON.stringify(manifest),
    public_id: input.publicId,
    timestamp,
    ...(transformation ? { transformation } : {}),
  };

  const form = new FormData();
  form.append("api_key", KEY());
  for (const [k, v] of Object.entries(signed)) form.append(k, v);
  form.append("signature", sign(signed));

  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD()}/video/create_slideshow`,
      { method: "POST", body: form, signal: AbortSignal.timeout(120_000) }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(
        `[cloudinary] slideshow failed (${res.status}): ${detail.slice(0, 220)}`
      );
      return null;
    }

    const json = (await res.json()) as {
      secure_url?: string;
      public_id?: string;
      bytes?: number;
      duration?: number;
    };
    if (!json.secure_url) return null;

    return {
      url: json.secure_url,
      publicId: String(json.public_id || input.publicId),
      bytes: Number(json.bytes) || 0,
      durationSec: Number.isFinite(json.duration) ? Number(json.duration) : null,
    };
  } catch (error) {
    console.warn("[cloudinary] slideshow error:", (error as Error).message);
    return null;
  }
}

/** Upload one scene image. Same contract as uploadAudio: null, never throw. */
export async function uploadImage(
  image: Buffer,
  opts: { publicId: string; folder?: string; contentType?: string }
): Promise<UploadResult | null> {
  if (!cloudinaryConfigured()) return null;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signed: Record<string, string> = {
    folder: opts.folder ?? "lens/scenes",
    overwrite: "true",
    public_id: opts.publicId,
    timestamp,
  };

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(image)], { type: opts.contentType || "image/png" })
  );
  form.append("api_key", KEY());
  for (const [k, v] of Object.entries(signed)) form.append(k, v);
  form.append("signature", sign(signed));

  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD()}/image/upload`,
      { method: "POST", body: form, signal: AbortSignal.timeout(45_000) }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[cloudinary] image upload failed (${res.status}): ${detail.slice(0, 160)}`);
      return null;
    }
    const json = (await res.json()) as any;
    if (!json.secure_url) return null;
    return {
      url: json.secure_url,
      publicId: String(json.public_id || opts.publicId),
      bytes: Number(json.bytes) || image.length,
      durationSec: null,
    };
  } catch (error) {
    console.warn("[cloudinary] image upload error:", (error as Error).message);
    return null;
  }
}


/** Upload one generated clip. Same contract: null, never throw. */
export async function uploadClip(
  clip: Buffer,
  opts: { publicId: string; folder?: string }
): Promise<UploadResult | null> {
  if (!cloudinaryConfigured()) return null;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signed: Record<string, string> = {
    folder: opts.folder ?? "lens/clips",
    overwrite: "true",
    public_id: opts.publicId,
    timestamp,
  };

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(clip)], { type: "video/mp4" }));
  form.append("api_key", KEY());
  for (const [k, v] of Object.entries(signed)) form.append(k, v);
  form.append("signature", sign(signed));

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD()}/video/upload`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[cloudinary] clip upload failed (${res.status}): ${detail.slice(0, 160)}`);
      return null;
    }
    const json = (await res.json()) as any;
    if (!json.secure_url) return null;
    return {
      url: json.secure_url,
      publicId: String(json.public_id || opts.publicId),
      bytes: Number(json.bytes) || clip.length,
      durationSec: Number.isFinite(json.duration) ? Number(json.duration) : null,
    };
  } catch (error) {
    console.warn("[cloudinary] clip upload error:", (error as Error).message);
    return null;
  }
}

/**
 * Splice uploaded clips into one video, with the narration over the top.
 *
 * This is a URL, not a job. Cloudinary applies `fl_splice` lazily on first
 * request and caches the result, so there is nothing to poll and nothing
 * to wait for here — which is why short per-scene clips are the right
 * shape: concatenating eight four-second clips is cheap, and the first
 * viewer pays the render once.
 *
 * UNVERIFIED — written against Cloudinary's transformation reference, not
 * run. The credentials in .env.local had the API secret in both the key
 * and the secret slot, so there was no working account to test against.
 */
export function spliceClipsUrl(input: {
  clipPublicIds: string[];
  audioPublicId?: string | null;
}): string | null {
  if (!cloudinaryConfigured()) return null;
  const [first, ...rest] = input.clipPublicIds;
  if (!first) return null;

  const esc = (id: string) => id.replace(/\//g, ":");

  // Every clip after the first is spliced onto the base asset in order.
  const splices = rest.map((id) => `fl_splice,l_video:${esc(id)}/fl_layer_apply`);

  // The narration goes on last so it spans the whole spliced timeline.
  const audio = input.audioPublicId
    ? [`l_audio:${esc(input.audioPublicId)}/fl_layer_apply`]
    : [];

  const chain = [...splices, ...audio].join("/");
  return `https://res.cloudinary.com/${CLOUD()}/video/upload/${chain}/${first}.mp4`;
}
