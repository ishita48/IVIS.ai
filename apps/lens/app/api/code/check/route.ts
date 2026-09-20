/**
 * POST /api/code/check — run the student's code and rule on it.
 *
 * The checker decides, the model explains. This route executes the code in
 * a real sandbox against a known input and compares the output; that is the
 * whole verdict, and no model is consulted to reach it.
 *
 * A hint is generated only when a real divergence already exists, and it is
 * capped by the hint ladder the same way every other surface is: the rung
 * comes from how many genuine attempts the student has made, counted from
 * the event log, not from how stuck they say they are.
 *
 * `rootCause` is passed to the model as private context and is never
 * returned. At rung EXPLAIN the model may finally teach the concept — it
 * still may not paste the fix.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { checkAgainstFixture, getFixture } from "@/lib/coding";
import { llmJson } from "@/lib/llm";
import { recordEvent, recentEvents } from "@/lib/events";
import { nextAllowedLevel } from "@/lib/reasoning";
import { recordMistake } from "@/lib/mistakes";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import type { HintLevel } from "@/lib/lens/contracts";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are LENS helping a student debug their own code. You never give the fix.

You are told the real failing input, what the program produced, what it should have produced, and privately why. Your job is to name the smallest next thing worth their attention at the rung you are given — and nothing beyond it.

POINT     name the line or expression to look at. No reason given.
ASK       one question they can answer by reading their own code.
NUDGE     one sentence naming the concept in play, not applied to their code.
EXPERIMENT suggest one small change to try and what to watch. Never the correct change.
EXPLAIN   teach the underlying idea properly. Still never write their fix.

You never paste corrected code, never state the corrected value or operator, and never say "change X to Y". If the rung is POINT you say less than you want to.`;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    problemId?: string;
    source?: string;
    sessionId?: string;
  };

  const source = String(body.source || "");
  if (!source.trim()) {
    return NextResponse.json({ error: "No code to run." }, { status: 400 });
  }

  const fixture = getFixture(String(body.problemId || ""));
  if (!fixture) return NextResponse.json({ error: "Unknown problem." }, { status: 404 });

  const session = await resolveOrCreateSession(userId, body.sessionId, "LENS Session");
  const sessionId = String(session._id);

  try {
    // ── The checker ──────────────────────────────────────────────
    const check = await checkAgainstFixture(fixture, source);

    await recordEvent({
      sessionId,
      userId,
      type: check.passed ? "experiment_completed" : "retry",
      concept: fixture.id,
      payload: {
        problemId: fixture.id,
        passed: check.passed,
        input: check.input,
        expected: check.expected,
        actual: check.actual,
        ms: check.ms,
        surface: "code",
      },
    }).catch(() => undefined);

    if (check.passed) {
      return NextResponse.json({ check, hint: null, rung: null });
    }

    // ── Only now, the model ──────────────────────────────────────
    const events = await recentEvents(sessionId, userId, 40);
    const rung: HintLevel = nextAllowedLevel(events);

    let hint: string | null = null;
    try {
      const out = await llmJson<{ hint: string }>(
        SYSTEM,
        `Problem: ${fixture.problem}

Their code:
${source.slice(0, 2000)}

The checker ran it. On input ${check.input} it produced ${check.actual || "(an error)"} where ${check.expected} was expected.${check.stderr ? `\nRuntime error: ${check.stderr}` : ""}

PRIVATE — the actual cause, which you must NOT state: ${fixture.rootCause}

Rung: ${rung}. Reply as JSON {"hint": string}, one or two sentences.`,
        { temperature: 0.3, maxTokens: 220, thinking: "off", provider: "openai" }
      );
      hint = String(out?.hint || "").trim() || null;
    } catch {
      // No hint is an honest outcome; the failing case alone is a screen.
      hint = null;
    }

    if (hint) {
      await recordEvent({
        sessionId,
        userId,
        type: "hint_requested",
        concept: fixture.id,
        payload: { level: rung, surface: "code", problemId: fixture.id },
      }).catch(() => undefined);
    }

    // A repeated failure on the same problem is a belief worth remembering.
    const attempts = events.filter(
      (e) => e.type === "retry" && (e.payload as any)?.problemId === fixture.id
    ).length;
    if (attempts >= 2) {
      void recordMistake({
        userId,
        sessionId,
        surface: "reasoning",
        concept: fixture.id,
        belief: `On "${fixture.problem}", expects ${check.expected} but the code yields ${check.actual || "an error"} for ${check.input}`,
        rootCause: fixture.rootCause,
        evidence: `${attempts + 1} failing runs on ${fixture.id}`,
      }).catch(() => undefined);
    }

    return NextResponse.json({ check, hint, rung, sessionId });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not run that." },
      { status: 502 }
    );
  }
}
