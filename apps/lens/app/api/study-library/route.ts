/**
 * /api/study-library — the flashcards and quiz questions the student kept.
 *
 * GET     ?kind=card|question       list saved items, newest first
 * POST    { kind, item }            save one
 * DELETE  ?kind=&id=                remove one
 *
 * Saving writes one event and nothing else; the library is those events
 * read back (lib/study-library.ts). Un-saving writes an event too rather
 * than deleting one, so the record of what a student kept and then dropped
 * stays intact — and so neither operation needs a mutable row.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { recordEvent } from "@/lib/events";
import {
  EVENTS_FOR,
  itemId,
  listSavedCards,
  listSavedQuestions,
} from "@/lib/study-library";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import { elasticPrimary } from "@/lib/elastic";
import type { Flashcard, LibraryKind, QuizQuestion } from "@/lib/lens/contracts";

export const runtime = "nodejs";

const asKind = (value: unknown): LibraryKind | null =>
  value === "card" || value === "question" ? value : null;

/** Same lazy-session convention as /api/events, Mongo-outage included. */
async function sessionFor(userId: string, given?: string | null): Promise<string> {
  const sessionId = typeof given === "string" ? given : "";
  if (sessionId && elasticPrimary()) return sessionId;
  try {
    const session = await resolveOrCreateSession(userId, sessionId, "LENS Session");
    return String(session._id);
  } catch (error) {
    if (!elasticPrimary()) throw error;
    console.warn(
      "[study-library] Mongo session unavailable; using Elastic session:",
      (error as Error).message
    );
    return sessionId || crypto.randomUUID();
  }
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const kind = asKind(new URL(req.url).searchParams.get("kind")) ?? "card";

  try {
    const items =
      kind === "card" ? await listSavedCards(userId) : await listSavedQuestions(userId);
    return NextResponse.json({ kind, items });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not load your library." },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    kind?: unknown;
    item?: Record<string, any>;
    sessionId?: string;
  };

  const kind = asKind(body.kind);
  if (!kind) {
    return NextResponse.json(
      { error: 'kind must be "card" or "question"' },
      { status: 400 }
    );
  }

  const raw = body.item ?? {};
  const difficulty =
    raw.difficulty === "easy" || raw.difficulty === "hard" ? raw.difficulty : "medium";
  const topic = String(raw.topic || "").trim() || "Untitled topic";
  const sourceTitle = String(raw.sourceTitle || "").trim() || "Your material";
  const sourceQuote = raw.sourceQuote ? String(raw.sourceQuote) : null;

  let item: Flashcard | QuizQuestion;

  if (kind === "card") {
    const front = String(raw.front || "").trim();
    const back = String(raw.back || "").trim();
    if (!front || !back) {
      return NextResponse.json(
        { error: "A card needs both a front and a back." },
        { status: 400 }
      );
    }
    // Recompute the id server-side: the client is not trusted to decide
    // what two items are the same item.
    item = {
      id: itemId(front, back),
      front,
      back,
      topic,
      difficulty,
      sourceTitle,
      sourceQuote,
    };
  } else {
    const prompt = String(raw.prompt || "").trim();
    const choices = Array.isArray(raw.choices)
      ? raw.choices.map((c: unknown) => String(c)).filter(Boolean)
      : [];
    const correctIndex = Number(raw.correctIndex);
    if (!prompt || choices.length < 2) {
      return NextResponse.json(
        { error: "A question needs a prompt and at least two choices." },
        { status: 400 }
      );
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) {
      return NextResponse.json(
        { error: "correctIndex must point at one of the choices." },
        { status: 400 }
      );
    }
    item = {
      id: itemId(prompt, choices.join("|")),
      prompt,
      choices,
      correctIndex,
      explanation: String(raw.explanation || "").trim(),
      topic,
      difficulty,
      sourceTitle,
      sourceQuote,
    };
  }

  try {
    const sessionId = await sessionFor(userId, body.sessionId);
    await recordEvent({
      sessionId,
      userId,
      type: EVENTS_FOR[kind].saved,
      concept: topic,
      payload: { itemId: item.id, item },
    });
    return NextResponse.json({ kind, item, sessionId });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not save that." },
      { status: 502 }
    );
  }
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const kind = asKind(url.searchParams.get("kind")) ?? "card";
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const sessionId = await sessionFor(userId, url.searchParams.get("sessionId"));
    await recordEvent({
      sessionId,
      userId,
      type: EVENTS_FOR[kind].unsaved,
      payload: { itemId: id },
    });
    return NextResponse.json({ removed: id, kind });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not remove that." },
      { status: 502 }
    );
  }
}
