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
import { recordEvent, recentEvents } from "@/lib/events";
import { nextAllowedLevel } from "@/lib/reasoning";
import { runCodeCouncil } from "@/lib/coding-council";
import { recordMistake } from "@/lib/mistakes";
import { resolveOrCreateSession } from "@/lib/session-helpers";
import type { HintLevel } from "@/lib/lens/contracts";

export const runtime = "nodejs";
export const maxDuration = 60;

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

    // ── Only now, the agents ─────────────────────────────────────
    const events = await recentEvents(sessionId, userId, 40);
    const rung: HintLevel = nextAllowedLevel(events);
    const attempts = events.filter(
      (e) => e.type === "retry" && (e.payload as any)?.problemId === fixture.id
    ).length;

    const council = await runCodeCouncil({
      fixture,
      check,
      source,
      rung,
      attempts,
      sessionId,
      userId,
    });
    const hint = council.hint;

    if (hint) {
      await recordEvent({
        sessionId,
        userId,
        type: "hint_requested",
        concept: fixture.id,
        payload: {
          level: rung,
          surface: "code",
          problemId: fixture.id,
          gated: council.gated,
          verified: council.verified,
        },
      }).catch(() => undefined);
    }

    // The trace is an event like everything else, so the metrics strip and
    // the reasoning tab aggregate this surface alongside the others.
    await recordEvent({
      sessionId,
      userId,
      type: "orchestrator_run",
      concept: fixture.id,
      payload: {
        steps: council.steps,
        totalMs: council.steps.reduce((n, st) => n + st.ms, 0),
        modelCalls: council.modelCalls,
        callsAvoided: council.callsAvoided,
        verified: council.verified,
        surface: "code",
      },
    }).catch(() => undefined);

    // A repeated failure on the same problem is a belief worth remembering.
    // `attempts` is the same count the gate used, so what gets written and
    // what gets recalled can never drift apart.
    if (attempts >= 2) {
      void recordMistake({
        userId,
        sessionId,
        surface: "code",
        concept: fixture.id,
        belief: `On "${fixture.problem}", expects ${check.expected} but the code yields ${check.actual || "an error"} for ${check.input}`,
        rootCause: fixture.rootCause,
        evidence: `${attempts + 1} failing runs on ${fixture.id}`,
      }).catch(() => undefined);
    }

    return NextResponse.json({
      check,
      hint,
      rung,
      sessionId,
      trace: {
        steps: council.steps,
        modelCalls: council.modelCalls,
        callsAvoided: council.callsAvoided,
        verified: council.verified,
        verifyNote: council.verifyNote,
        gated: council.gated,
      },
      recalled: council.recalled,
      citation: council.citation,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not run that." },
      { status: 502 }
    );
  }
}
