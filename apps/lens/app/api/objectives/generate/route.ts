/**
 * POST /api/objectives/generate
 *
 * A prediction question about what this student is actually working on,
 * instead of the three curated fixtures.
 *
 * DEMO_OBJECTIVES holds a gear train, an LED solder and a percent
 * discount, each with a hand-written misconception ladder. They are good
 * questions and they were the right way to start, but a student who has
 * just uploaded their own lecture notes and pointed a camera at their own
 * desk is offered a gear train, and the product looks like a fixture
 * rather than a tutor.
 *
 * So the question is generated from two real inputs, whichever exist:
 * the passages indexed for this session, and the most recent thing the
 * camera actually reported seeing. With neither, this returns 404 and the
 * client keeps the curated set — a picker with three known-good questions
 * beats an empty card.
 *
 * NO CORRECT ANSWER IS RETURNED, and none is even generated. The curated
 * objectives carry `correctIndex`, and DEMO_OBJECTIVES is imported into a
 * client component, so today the right answer is sitting in the browser
 * bundle for anyone who opens devtools. Nothing here needs it: the
 * student's pick is written as a `prediction` event and the reasoning
 * engine diagnoses the belief behind it, which is the same path a spoken
 * prediction takes and the reason the card can say a pick is worth a rung
 * rather than a verdict.
 *
 * The wrong options are the point. A question whose distractors are
 * arbitrary teaches nothing when picked; each one here has to correspond
 * to a way of misreading the material, because that is what the ladder
 * then has something to say about.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hybridSearchElastic } from "@/lib/elastic";
import { llmJson } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You write one prediction question for a student, about material they are working on right now.

The question asks them to commit to an answer BEFORE they check it. It must be answerable from the material, short, and concrete.

Every wrong option must be a way a real student misreads this material — a confusion worth naming. Never write filler options, joke options, or "none of the above".

Never indicate which option is correct, in any field. Never number or order the options so the answer is guessable.

Reply as json: {"title": string, "objective": string, "question": string, "options": string[]}
title: 2-4 words naming the thing, for a tab.
objective: one sentence saying what the student is trying to work out.
options: 3 or 4 short answers, one correct, the rest plausible misreadings.`;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string | null;
    observation?: string | null;
  };

  const sessionId = body.sessionId ? String(body.sessionId) : null;
  const observation = String(body.observation || "").trim().slice(0, 600);

  // Session material first, then anything of theirs, then whatever the
  // camera last saw. Each is real; none is invented.
  let passages: Array<Record<string, unknown>> = [];
  if (sessionId) {
    passages = (await hybridSearchElastic({
      userId,
      query: observation || "the main idea in this material",
      k: 6,
      sessionId,
    }).catch(() => [])) as Array<Record<string, unknown>>;
  }
  if (!passages.length) {
    passages = (await hybridSearchElastic({
      userId,
      query: observation || "the main idea in this material",
      k: 6,
    }).catch(() => [])) as Array<Record<string, unknown>>;
  }

  if (!passages.length && !observation) {
    return NextResponse.json(
      { error: "Nothing to build a question from yet." },
      { status: 404 }
    );
  }

  const material = passages
    .map(
      (p, i) =>
        `SOURCE ${i + 1}: ${String(p.title || "Untitled")}\n${String(p.text || "").slice(0, 1400)}`
    )
    .join("\n\n");

  const seen = observation
    ? `\n\nWhat the camera reports on the desk right now: ${observation}`
    : "";

  try {
    const out = await llmJson<{
      title?: string;
      objective?: string;
      question?: string;
      options?: string[];
    }>(SYSTEM, `${material}${seen}\n\nWrite the question as json.`, {
      temperature: 0.4,
      maxTokens: 400,
      thinking: "off",
      provider: "openai",
    });

    const question = String(out?.question || "").trim();
    const options = (out?.options ?? [])
      .map((o) => String(o).trim())
      .filter(Boolean)
      .slice(0, 4);

    // Two options is a coin flip, and a coin flip tells the ladder nothing
    // about what the student believes.
    if (!question || options.length < 3) {
      return NextResponse.json(
        { error: "Could not write a usable question from this material." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      objective: {
        id: `generated:${sessionId ?? "any"}:${Date.now()}`,
        title: String(out?.title || "Your material").trim().slice(0, 40),
        objective: String(out?.objective || question).trim(),
        question,
        options,
      },
      groundedIn: passages
        .map((p) => String(p.title || ""))
        .filter((t, i, a) => t && a.indexOf(t) === i)
        .slice(0, 3),
      usedObservation: !!observation,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not generate a question." },
      { status: 502 }
    );
  }
}
