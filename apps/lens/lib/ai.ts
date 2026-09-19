/**
 * Source context helpers.
 * ─────────────────────────────────────────────────────────────────────
 * What survived from StudyO's lib/ai.ts: the SourceForAI shape and the
 * context builder. The generators (flashcards, quiz, concept map, video,
 * canvas) were deleted with their features — LENS grounds answers in the
 * student's material, it does not manufacture study artifacts from it.
 *
 * Model calls go through lib/llm.ts (text/reasoning) or lib/vision.ts
 * (frames). Nothing calls OpenAI directly from a route handler.
 */

export type SourceForAI = {
  _id: string;
  title: string;
  kind: string;
  extractedText?: string | null;
  content?: string | null;
  url?: string | null;
};

/**
 * Flattens active sources into a prompt-ready block. Per-source cap keeps
 * one 200-page PDF from crowding out the other four things the student
 * actually cares about.
 */
export function buildSourceContext(
  sources: SourceForAI[],
  maxCharsEach = 8000
): string {
  if (!sources.length) return "(no sources loaded)";
  return sources
    .map((s, i) => {
      const body = (s.extractedText || s.content || "").trim();
      const clipped =
        body.length > maxCharsEach ? body.slice(0, maxCharsEach) + " …[truncated]" : body;
      return `--- SOURCE ${i + 1}: "${s.title}" (${s.kind})${
        s.url ? ` <${s.url}>` : ""
      } ---\n${clipped || "(no extractable text)"}`;
    })
    .join("\n\n");
}
