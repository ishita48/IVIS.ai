import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hybridSearchElastic } from "@/lib/elastic";
import { llmJson } from "@/lib/llm";
import { itemId, priorDifficulty } from "@/lib/study-library";
import type { Flashcard, QuizQuestion } from "@/lib/lens/contracts";

export const runtime = "nodejs";
export const maxDuration = 60;

type Mode = "summary" | "flashcards" | "quiz" | "concept-map" | "video";

const SYSTEM = `You are the study-tools engine for LENS. Use only the supplied source excerpts.
Never invent facts or citations. Return JSON only. Keep the output concise, useful, and faithful to the material.

For quizzes specifically:
- Exactly four choices per question. Every wrong choice must be plausible to someone who half-understands the material — a question with three obviously-silly options tests nothing.
- "explanation" says why the right answer is right, in one or two sentences. It is shown only after the student commits.

For video summaries specifically — this is narrated aloud and watched, not read:
- "narration" is spoken text. Write it to be HEARD: short sentences, no bullet syntax, no markdown, no "as you can see", no numbers read as digits where a word is clearer. One idea per scene.
- "onScreen" is 2-4 very short lines that appear on the slide WHILE that narration plays. They are not the narration repeated — they are the thing worth keeping: a term, a ratio, a rule. Three to six words each.
- "keyTerm" is the single concept this scene is about, two or three words. It labels the slide.
- Five to seven scenes. "durationSec" is your estimate of the narration's spoken length, roughly 2.5 words per second.
- "hook" is one sentence that says why this matters, spoken first.

For flashcards and quizzes:
- "topic" is a short concept label, two to four words, shared by every card testing the same idea. The end-of-deck report groups by it, so a topic used by exactly one card is usually too specific.
- "sourceTitle" must be copied exactly from the SOURCE header the fact came from.
- "sourceQuote" must be a sentence COPIED CHARACTER FOR CHARACTER from that excerpt — the sentence that makes the answer true. Do not paraphrase it, do not tidy it, do not join two sentences. It is checked against the excerpt and dropped if it does not appear.`;

const SHAPES: Record<Mode, string> = {
  summary: `{ "title": string, "overview": string, "keyPoints": string[], "sourceTitles": string[] }`,
  flashcards: `{ "cards": [{ "front": string, "back": string, "topic": string, "difficulty": "easy"|"medium"|"hard", "sourceTitle": string, "sourceQuote": string }] }`,
  quiz: `{ "title": string, "questions": [{ "prompt": string, "choices": string[], "correctIndex": number, "explanation": string, "topic": string, "difficulty": "easy"|"medium"|"hard", "sourceTitle": string, "sourceQuote": string }] }`,
  "concept-map": `{ "title": string, "nodes": [{ "id": string, "label": string, "description": string }], "edges": [{ "from": string, "to": string, "relationship": string }] }`,
  video: `{ "title": string, "hook": string, "scenes": [{ "heading": string, "narration": string, "onScreen": string[], "keyTerm": string, "sourceTitle": string, "durationSec": number }], "transcript": string }`,
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
      {
        temperature: 0.35,
        maxTokens: mode === "video" ? 1800 : 1400,
        thinking: "off",
        // See lib/reasoning.ts — Gemma takes ~25s for a structured reply on
        // this account, and a deck the student is waiting on cannot.
        provider: "openai",
      }
    );
    const sources = hits.map((hit: any) => ({ title: hit.title, score: hit.score }));

    if (mode === "flashcards") {
      return NextResponse.json({
        mode,
        result: { ...result, cards: await decorateCards(result, excerpts, userId) },
        sources,
      });
    }

    if (mode === "quiz") {
      return NextResponse.json({
        mode,
        result: { ...result, questions: await decorateQuestions(result, excerpts, userId) },
        sources,
      });
    }

    return NextResponse.json({ mode, result, sources: hits.map((hit: any) => ({ title: hit.title, score: hit.score })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Study tool generation failed" }, { status: 502 });
  }
}
/** Collapse whitespace so a quote check is not defeated by line wrapping. */
const flatten = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Give every card a stable id, and verify its quote actually occurs in the
 * excerpts it was generated from.
 *
 * The check is the point. A flashcard that cites the student's own notes is
 * only worth more than one that doesn't if the citation is real — so an
 * unverifiable quote is dropped to null and the card renders without one,
 * rather than showing a sentence the model composed and attributed.
 * Same rule as the source tier: no generated citations.
 */
async function decorateCards(
  result: Record<string, unknown>,
  excerpts: string,
  userId: string
): Promise<Flashcard[]> {
  const raw = Array.isArray((result as any).cards) ? (result as any).cards : [];
  const haystack = flatten(excerpts);

  let history: Record<string, { wrong: number; attempts: number }> = {};
  try {
    history = await priorDifficulty(userId, "card");
  } catch {
    /* ordering is a nicety; never fail a deck over it */
  }

  const cards: Flashcard[] = raw
    .filter((c: any) => c?.front && c?.back)
    .map((c: any): Flashcard => {
      const front = String(c.front).trim();
      const back = String(c.back).trim();
      const quote = String(c.sourceQuote || "").trim();
      const verified = quote.length > 12 && haystack.includes(flatten(quote));

      return {
        id: itemId(front, back),
        front,
        back,
        topic: String(c.topic || "").trim() || "General",
        difficulty:
          c.difficulty === "easy" || c.difficulty === "hard" ? c.difficulty : "medium",
        sourceTitle: String(c.sourceTitle || "").trim() || "Your material",
        sourceQuote: verified ? quote : null,
      };
    });

  // Cards this student has missed before come first — the deck opens on
  // what they actually find hard rather than on card one of ten.
  return cards.sort(
    (a, b) => (history[b.id]?.wrong ?? 0) - (history[a.id]?.wrong ?? 0)
  );
}

/** Same id + quote verification for quiz questions. */
async function decorateQuestions(
  result: Record<string, unknown>,
  excerpts: string,
  userId: string
): Promise<QuizQuestion[]> {
  const raw = Array.isArray((result as any).questions) ? (result as any).questions : [];
  const haystack = flatten(excerpts);

  let history: Record<string, { wrong: number; attempts: number }> = {};
  try {
    history = await priorDifficulty(userId, "question");
  } catch {
    /* ordering is a nicety; never fail a quiz over it */
  }

  const questions: QuizQuestion[] = raw
    .filter(
      (q: any) =>
        q?.prompt &&
        Array.isArray(q.choices) &&
        q.choices.length >= 2 &&
        Number.isInteger(q.correctIndex) &&
        q.correctIndex >= 0 &&
        q.correctIndex < q.choices.length
    )
    .map((q: any): QuizQuestion => {
      const prompt = String(q.prompt).trim();
      const choices = q.choices.map((c: unknown) => String(c).trim());
      const quote = String(q.sourceQuote || "").trim();
      const verified = quote.length > 12 && haystack.includes(flatten(quote));

      return {
        id: itemId(prompt, choices.join("|")),
        prompt,
        choices,
        correctIndex: Number(q.correctIndex),
        explanation: String(q.explanation || "").trim(),
        topic: String(q.topic || "").trim() || "General",
        difficulty:
          q.difficulty === "easy" || q.difficulty === "hard" ? q.difficulty : "medium",
        sourceTitle: String(q.sourceTitle || "").trim() || "Your material",
        sourceQuote: verified ? quote : null,
      };
    });

  return questions.sort(
    (a, b) => (history[b.id]?.wrong ?? 0) - (history[a.id]?.wrong ?? 0)
  );
}
