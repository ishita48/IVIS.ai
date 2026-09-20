/**
 * POST /api/reasoning/analyze
 *
 * Reconstructs where the student's reasoning diverged, from the session's
 * real event log plus retrieval over their own material.
 *
 * This route previously called a `analyze({ problem, code, run, ... })`
 * helper from a code-debugging slice that no longer exists. The engine on
 * main is session-based — and the store has always POSTed the session shape
 * here — so the route now matches its actual caller.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { analyzeReasoning } from "@/lib/reasoning";
import { formatOpenAIError, openAIErrorStatus } from "@/lib/openai-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    objective?: string;
    latestObservation?: string | null;
    spokenText?: string | null;
    useSources?: boolean;
  };

  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    const state = await analyzeReasoning({
      sessionId: body.sessionId,
      userId,
      objective: body.objective,
      latestObservation: body.latestObservation ?? null,
      spokenText: body.spokenText ?? null,
      useSources: body.useSources,
    });

    return NextResponse.json({ state, citations: state.citations ?? [] });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: formatOpenAIError(error) },
      { status: openAIErrorStatus(error) }
    );
  }
}
