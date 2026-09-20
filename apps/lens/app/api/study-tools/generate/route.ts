import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hybridSearchElastic } from "@/lib/elastic";
import { llmJson } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

type Mode = "summary" | "flashcards" | "quiz" | "concept-map" | "video";

const SYSTEM = `You are the study-tools engine for LENS. Use only the supplied source excerpts.
Never invent facts or citations. Return JSON only. Keep the output concise, useful, and faithful to the material.`;

const SHAPES: Record<Mode, string> = {
  summary: `{ "title": string, "overview": string, "keyPoints": string[], "sourceTitles": string[] }`,
  flashcards: `{ "cards": [{ "front": string, "back": string, "difficulty": "easy"|"medium"|"hard", "sourceTitle": string }] }`,
  quiz: `{ "title": string, "questions": [{ "prompt": string, "choices": string[], "correctIndex": number, "explanation": string, "sourceTitle": string }] }`,
  "concept-map": `{ "title": string, "nodes": [{ "id": string, "label": string, "description": string }], "edges": [{ "from": string, "to": string, "relationship": string }] }`,
  video: `{ "title": string, "hook": string, "scenes": [{ "heading": string, "narration": string, "visualPrompt": string, "durationSec": number }], "transcript": string }`,
};

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { mode?: Mode; query?: string };
  const mode = body.mode;
  if (!mode || !(mode in SHAPES)) {
    return NextResponse.json({ error: "mode must be summary, flashcards, quiz, concept-map, or video" }, { status: 400 });
  }

  const query = String(body.query || "study the uploaded material").trim();
  const hits = await hybridSearchElastic({ userId, query, k: 8 });
  if (!hits.length) {
    return NextResponse.json({ error: "No indexed source material found. Upload a PDF, URL, or video first." }, { status: 404 });
  }

  const excerpts = hits
    .map((hit: any, index: number) => `SOURCE ${index + 1}: ${hit.title}\n${String(hit.text || hit.extractedText || "").slice(0, 1800)}`)
    .join("\n\n");
  try {
    const result = await llmJson<Record<string, unknown>>(
      SYSTEM,
      `Create a ${mode} from these excerpts. Return exactly this shape:\n${SHAPES[mode]}\n\n${excerpts}`,
      { temperature: 0.35, maxTokens: mode === "video" ? 1800 : 1400, thinking: "off" }
    );
    return NextResponse.json({ mode, result, sources: hits.map((hit: any) => ({ title: hit.title, score: hit.score })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Study tool generation failed" }, { status: 502 });
  }
}