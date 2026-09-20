/**
 * /api/mistakes — the student's belief history, on Elastic kNN.
 *
 * GET   ?q=              recall beliefs close to `q` (vector search)
 * GET                    list everything, most persistent first
 * POST  { belief, ... }  record one, merging into a matching belief
 * PATCH { id }           mark one resolved
 *
 * Every surface writes here — camera, quiz, flashcards, guide, reasoning —
 * which is the point: a misconception recorded while debugging a circuit
 * is the same row that gets recalled when a quiz distractor catches the
 * same belief three days later.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  listMistakes,
  mistakesEnabled,
  recallMistakes,
  recordMistake,
  resolveMistake,
  type MistakeSurface,
} from "@/lib/mistakes";
import { resolveOrCreateSession } from "@/lib/session-helpers";

export const runtime = "nodejs";
export const maxDuration = 30;

const SURFACES: MistakeSurface[] = [
  "camera",
  "quiz",
  "flashcards",
  "guide",
  "reasoning",
];

const asSurface = (value: unknown): MistakeSurface =>
  SURFACES.includes(value as MistakeSurface) ? (value as MistakeSurface) : "reasoning";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!mistakesEnabled()) {
    return NextResponse.json(
      { error: "Mistake memory needs Elastic. Set ELASTIC_URL." },
      { status: 503 }
    );
  }

  const params = new URL(req.url).searchParams;
  const query = (params.get("q") || "").trim();

  try {
    if (query) {
      const mistakes = await recallMistakes({
        userId,
        query,
        k: Math.min(Number(params.get("k")) || 4, 10),
        excludeSessionId: params.get("excludeSessionId") || undefined,
      });
      return NextResponse.json({ mistakes, mode: "recall" });
    }

    const mistakes = await listMistakes(userId);
    return NextResponse.json({ mistakes, mode: "list" });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not read mistake memory." },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!mistakesEnabled()) {
    return NextResponse.json(
      { error: "Mistake memory needs Elastic. Set ELASTIC_URL." },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const belief = String(body.belief || "").trim();
  if (belief.length < 8) {
    return NextResponse.json(
      { error: "A belief needs to be a sentence, not a label." },
      { status: 400 }
    );
  }

  try {
    const session = await resolveOrCreateSession(userId, body.sessionId, "LENS Session");
    const result = await recordMistake({
      userId,
      sessionId: String(session._id),
      surface: asSurface(body.surface),
      concept: body.concept,
      belief,
      rootCause: body.rootCause,
      evidence: body.evidence,
      sourceTitle: body.sourceTitle,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Could not embed that belief." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      mistake: result.mistake,
      recurrence: result.recurrence,
      sessionId: String(session._id),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not record that." },
      { status: 502 }
    );
  }
}

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    await resolveMistake(id);
    return NextResponse.json({ resolved: id });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not resolve that." },
      { status: 502 }
    );
  }
}
