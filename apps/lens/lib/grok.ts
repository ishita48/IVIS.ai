/**
 * xAI Grok Imagine — reference images for data objectives.
 * ─────────────────────────────────────────────────────────────────────
 * A chart of the true answer, generated after the query runs, so the
 * student can see the distribution instead of only reading a sentence.
 *
 * Never throws: an unset key or a failed call returns null. The data
 * objective's answer and ladder still land either way.
 */

const XAI_IMAGES_URL = "https://api.x.ai/v1/images/generations";
const XAI_IMAGE_MODEL = "grok-imagine-image";

/**
 * Ask Grok Imagine for a single image and return its URL, or null when
 * the key is missing or the call fails.
 */
export async function generateReferenceImage(
  prompt: string
): Promise<string | null> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey || !prompt.trim()) return null;

  try {
    const response = await fetch(XAI_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: XAI_IMAGE_MODEL,
        prompt,
        n: 1,
        response_format: "url",
      }),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as {
      data?: { url?: string }[];
    };
    const url = body.data?.[0]?.url?.trim();
    return url || null;
  } catch {
    return null;
  }
}
