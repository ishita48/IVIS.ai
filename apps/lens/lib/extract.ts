// Content extractors: PDF bytes -> text, YouTube URL -> transcript, webpage URL -> text
// Kept tolerant: each returns { ok, text, meta } and never throws for expected failures.

export type ExtractResult = {
  ok: boolean;
  text: string;
  meta: Record<string, any>;
  error?: string;
};

// ── PDF ───────────────────────────────────────────────────────────────
export async function extractPdf(buf: Buffer): Promise<ExtractResult> {
  // ── Primary: pdf-parse (fast, works for most PDFs) ──────────────────
  try {
    const mod: any = await import("pdf-parse");
    const pdfParse = mod.default || mod;
    const data = await pdfParse(buf, { normalizeWhitespace: false });
    const text = (data.text || "").trim();
    if (text.length > 10) {
      return {
        ok: true,
        text,
        meta: {
          pageCount: data.numpages ?? null,
          wordCount: text.split(/\s+/).filter(Boolean).length,
        },
      };
    }
  } catch {
    // Fall through to pdfjs-dist fallback
  }

  // ── Fallback: pdfjs-dist (handles bad XRef, math/formula PDFs, complex tables) ──
  // pdfjs-dist v5 includes built-in XRef repair and page-by-page tolerance.
  // IMPORTANT: the default ESM build references browser-only globals
  // (DOMMatrix, ImageData, Path2D) and throws `ReferenceError: DOMMatrix is
  // not defined` when loaded in Node. The `legacy` build targets older runtimes
  // and works server-side. We also polyfill the globals as a belt-and-braces
  // measure for any worker/sub-module that still touches them.
  try {
    if (typeof (globalThis as any).DOMMatrix === "undefined") {
      class DOMMatrixShim {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
        m11 = 1; m12 = 0; m13 = 0; m14 = 0;
        m21 = 0; m22 = 1; m23 = 0; m24 = 0;
        m31 = 0; m32 = 0; m33 = 1; m34 = 0;
        m41 = 0; m42 = 0; m43 = 0; m44 = 1;
        is2D = true;
        isIdentity = true;
        constructor(_init?: any) {}
        multiply() { return this; }
        translate() { return this; }
        scale() { return this; }
        rotate() { return this; }
        invertSelf() { return this; }
        transformPoint(p: any) { return p; }
      }
      (globalThis as any).DOMMatrix = DOMMatrixShim;
    }
    if (typeof (globalThis as any).ImageData === "undefined") {
      (globalThis as any).ImageData = class { constructor(public data: any, public width: number, public height: number) {} };
    }
    if (typeof (globalThis as any).Path2D === "undefined") {
      (globalThis as any).Path2D = class { addPath() {} moveTo() {} lineTo() {} closePath() {} };
    }

    // Prefer the legacy Node-safe build; fall back to the default if that path
    // isn't available in the installed version.
    let pdfjs: any;
    try {
      pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as any);
    } catch {
      pdfjs = await import("pdfjs-dist");
    }
    // pdfjs always needs *some* worker. In a Node serverless context we point
    // GlobalWorkerOptions.workerSrc at the legacy worker file inside
    // node_modules (resolved via createRequire so it works both in dev and in
    // the bundled Next.js serverless function). Setting it to "" trips
    // "Setting up fake worker failed: No GlobalWorkerOptions.workerSrc
    // specified." inside pdfjs's setupFakeWorkerGlobal path.
    if (pdfjs.GlobalWorkerOptions) {
      // IMPORTANT: Do NOT use import.meta.url here. In Next.js with Turbopack,
      // import.meta.url resolves to a virtual "[project]/..." path, making
      // createRequire produce a path that doesn't exist on disk. process.cwd()
      // always returns the real project root (apps/lens/), so we build paths from
      // there instead.
      try {
        const { join } = await import("node:path");
        const { pathToFileURL } = await import("node:url");
        const { existsSync } = await import("node:fs");
        let workerUrl: string | null = null;
        for (const rel of [
          "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
          "node_modules/pdfjs-dist/build/pdf.worker.mjs",
          "node_modules/pdfjs-dist/legacy/build/pdf.worker.js",
          "node_modules/pdfjs-dist/build/pdf.worker.js",
        ]) {
          const abs = join(process.cwd(), rel);
          if (existsSync(abs)) {
            workerUrl = pathToFileURL(abs).href;
            break;
          }
        }
        if (workerUrl) {
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        }
        // If no worker file found, leave workerSrc unset and let pdfjs
        // attempt its own fallback (synchronous fake-worker path).
      } catch {
        // node: builtins unavailable — pdfjs will fall back on its own.
      }
    }
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buf),
      verbosity: 0,
      stopAtErrors: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;
    const pageTexts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: any) => item.str ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (pageText) pageTexts.push(pageText);
      } catch {
        // Skip pages that individually fail — still extract the rest
      }
    }
    const text = pageTexts.join("\n\n").trim();
    return {
      ok: text.length > 0,
      text,
      meta: {
        pageCount: doc.numPages,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      },
      ...(text.length === 0
        ? { error: "PDF has no extractable text (may be scanned/image-only — try a searchable PDF)" }
        : {}),
    };
  } catch (e: any) {
    return { ok: false, text: "", meta: {}, error: e?.message || "pdf extraction failed" };
  }
}

// ── DOCX (Word) ───────────────────────────────────────────────────────
export async function extractDocx(buf: Buffer): Promise<ExtractResult> {
  try {
    const mammoth: any = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = (result.value || "").trim();
    return {
      ok: text.length > 0,
      text,
      meta: { wordCount: text.split(/\s+/).filter(Boolean).length },
      ...(text.length === 0 ? { error: "DOCX appears to be empty" } : {}),
    };
  } catch (e: any) {
    return { ok: false, text: "", meta: {}, error: e?.message || "docx extraction failed" };
  }
}

// ── Plain text / Markdown ─────────────────────────────────────────────
export function extractPlainText(buf: Buffer): ExtractResult {
  try {
    const text = buf.toString("utf-8").trim();
    return {
      ok: text.length > 0,
      text,
      meta: { wordCount: text.split(/\s+/).filter(Boolean).length },
    };
  } catch (e: any) {
    return { ok: false, text: "", meta: {}, error: e?.message || "text read failed" };
  }
}

// ── XLSX / Spreadsheet ────────────────────────────────────────────────
export async function extractXlsx(buf: Buffer): Promise<ExtractResult> {
  try {
    const XLSX: any = await import("xlsx");
    const workbook = XLSX.read(buf, { type: "buffer", cellText: true, cellDates: true });
    const sheetTexts: string[] = workbook.SheetNames.map((name: string) => {
      const ws = workbook.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      return `=== Sheet: ${name} ===\n${csv.trim()}`;
    });
    const text = sheetTexts.join("\n\n").trim();
    return {
      ok: text.length > 0,
      text,
      meta: {
        wordCount: text.split(/\s+/).filter(Boolean).length,
        pageCount: workbook.SheetNames.length,
      },
    };
  } catch (e: any) {
    return { ok: false, text: "", meta: {}, error: e?.message || "xlsx extraction failed" };
  }
}

// ── YouTube ───────────────────────────────────────────────────────────
export function parseYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1) || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "v");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return null;
  } catch {
    return null;
  }
}

export async function extractYouTube(url: string): Promise<ExtractResult> {
  const id = parseYouTubeId(url);
  if (!id) return { ok: false, text: "", meta: {}, error: "Could not parse YouTube ID" };

  const thumbUrl = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;

  // ── Primary: official transcript via youtube-transcript ─────────────
  try {
    const mod: any = await import("youtube-transcript");
    const YoutubeTranscript = mod.YoutubeTranscript || mod.default?.YoutubeTranscript || mod.default;

    // Try default language first, then force English (handles some mis-detected lang cases)
    let items: any[] | null = null;
    for (const opts of [{}, { lang: "en" }, { lang: "en-US" }]) {
      try {
        items = await YoutubeTranscript.fetchTranscript(id, opts);
        if (items?.length) break;
      } catch {
        // try next option
      }
    }

    if (items?.length) {
      const text = items.map((i: any) => i.text).join(" ").replace(/\s+/g, " ").trim();
      const last = items[items.length - 1];
      const duration = last ? Math.round((last.offset + last.duration) / 1000) : null;
      return { ok: true, text, meta: { duration, thumbnailUrl: thumbUrl, videoId: id } };
    }
  } catch {
    // transcript disabled or unavailable — fall through to description scrape
  }

  // ── Fallback: scrape YouTube page for title + description ───────────
  // When captions are disabled we still want something useful for the AI.
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (pageRes.ok) {
      const html = await pageRes.text();

      // Extract title from <title> or og:title
      const titleMatch =
        html.match(/<meta property="og:title" content="([^"]+)"/) ||
        html.match(/<title>([^<]+)<\/title>/);
      const pageTitle = titleMatch ? titleMatch[1].replace(" - YouTube", "").trim() : "";

      // Extract description from og:description or ytInitialData
      const descMatch =
        html.match(/<meta property="og:description" content="([^"]+)"/) ||
        html.match(/<meta name="description" content="([^"]+)"/);
      const description = descMatch
        ? descMatch[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim()
        : "";

      // Also try to pull structured description from ytInitialData JSON blob
      let fullDesc = description;
      try {
        const dataMatch = html.match(/var ytInitialData = ({.+?});<\/script>/s);
        if (dataMatch) {
          const ytData = JSON.parse(dataMatch[1]);
          const desc =
            ytData?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[1]
              ?.videoSecondaryInfoRenderer?.description?.runs
              ?.map((r: any) => r.text)
              .join("") ?? "";
          if (desc.length > fullDesc.length) fullDesc = desc;
        }
      } catch {
        // ytInitialData parse failed — keep og:description
      }

      const text = [pageTitle, fullDesc].filter(Boolean).join("\n\n").trim();
      if (text.length > 30) {
        return {
          ok: true,
          text: `[Note: This video has captions disabled. The following is the video description.]\n\n${text}`,
          meta: { duration: null, thumbnailUrl: thumbUrl, videoId: id, fromDescription: true },
        };
      }
    }
  } catch {
    // page scrape failed too
  }

  return {
    ok: false,
    text: "",
    meta: { videoId: id, thumbnailUrl: thumbUrl },
    error: "Transcript unavailable — this video has captions disabled and no description could be retrieved.",
  };
}

// ── Webpage ───────────────────────────────────────────────────────────
export async function extractWebpage(url: string): Promise<ExtractResult> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; LENSBot/1.0)",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, text: "", meta: {}, error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const cheerio: any = await import("cheerio");
    const $ = cheerio.load(html);

    // Strip noise
    $("script, style, nav, footer, aside, noscript, iframe, svg").remove();

    const title = ($("title").first().text() || "").trim() || new URL(url).hostname;
    // Prefer <main>/<article>, fall back to <body>
    const main = $("main").first();
    const article = $("article").first();
    const container = main.length ? main : article.length ? article : $("body");
    const text = container
      .text()
      .replace(/[\t\r]+/g, " ")
      .replace(/\n{2,}/g, "\n\n")
      .replace(/ {2,}/g, " ")
      .trim();

    return {
      ok: true,
      text,
      meta: { title, wordCount: text.split(/\s+/).filter(Boolean).length },
    };
  } catch (e: any) {
    return { ok: false, text: "", meta: {}, error: e?.message || "fetch failed" };
  }
}

// ── Audio / Video (ElevenLabs Scribe — Speech-to-Text) ────────────────
// Transcribes lecture audio/video uploads (e.g. from the iOS recorder app)
// so the chatbot has searchable text to ground answers in.
// Docs: https://elevenlabs.io/docs/api-reference/speech-to-text
export async function extractAudio(
  buf: Buffer,
  fileName: string,
  mimeType: string
): Promise<ExtractResult> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return {
      ok: false,
      text: "",
      meta: {},
      error: "ELEVENLABS_API_KEY missing — cannot transcribe audio",
    };
  }

  try {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(buf)], {
      type: mimeType || "application/octet-stream",
    });
    form.append("file", blob, fileName);
    form.append("model_id", "scribe_v1"); // ElevenLabs Scribe
    form.append("tag_audio_events", "true");
    form.append("diarize", "true"); // separates speakers (professor vs students)
    form.append("timestamps_granularity", "word");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        text: "",
        meta: {},
        error: `ElevenLabs STT ${res.status}: ${errText.slice(0, 200)}`,
      };
    }

    const data = await res.json();
    const text: string = (data.text || "").trim();
    if (!text) {
      return {
        ok: false,
        text: "",
        meta: {},
        error: "Transcription returned empty text",
      };
    }

    // Diarized transcript — prefix speaker labels so the chatbot can tell
    // who said what (useful for Q&A vs lecture content).
    let formatted = text;
    if (Array.isArray(data.words) && data.words.length) {
      const segments: { speaker: string; text: string }[] = [];
      let current: { speaker: string; text: string } | null = null;
      for (const w of data.words) {
        const speaker = w.speaker_id || "speaker_0";
        const token = w.text || "";
        if (!current || current.speaker !== speaker) {
          if (current) segments.push(current);
          current = { speaker, text: token };
        } else {
          current.text += token;
        }
      }
      if (current) segments.push(current);
      if (segments.length > 1) {
        formatted = segments
          .map((s) => `[${s.speaker}] ${s.text.trim()}`)
          .join("\n\n");
      }
    }

    return {
      ok: true,
      text: formatted,
      meta: {
        wordCount: text.split(/\s+/).filter(Boolean).length,
        language: data.language_code || "en",
        duration: data.duration_seconds ?? null,
        speakerCount: data.words
          ? new Set(data.words.map((w: any) => w.speaker_id)).size
          : null,
        model: "scribe_v1",
      },
    };
  } catch (e: any) {
    return {
      ok: false,
      text: "",
      meta: {},
      error: e?.message || "audio transcription failed",
    };
  }
}

