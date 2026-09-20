/**
 * /api/classes/[id]/sessions — scheduled sessions for a class.
 *
 * GET     list this class's upcoming sessions
 * POST    schedule one { topic, date, time, maxStudents, location, resource, prompt, challenge }
 * DELETE  cancel one ?sessionId=...
 *
 * Persisted in Elastic (lib/classroom.ts) like everything else on the
 * teacher dashboard — no in-memory list that vanishes on refresh.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { cancelSession, createSession, getClass, listSessions } from "@/lib/classroom";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  try {
    const klass = await getClass(id);
    if (!klass) return NextResponse.json({ error: "Class not found" }, { status: 404 });

    const sessions = await listSessions(id);
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not load sessions." },
      { status: 502 }
    );
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    topic?: string;
    date?: string;
    time?: string;
    maxStudents?: number;
    location?: string;
    resource?: string;
    prompt?: string;
    challenge?: string;
  };
  const topic = String(body.topic || "").trim();
  if (!topic) {
    return NextResponse.json({ error: "A session needs a topic." }, { status: 400 });
  }

  try {
    const klass = await getClass(id);
    if (!klass) return NextResponse.json({ error: "Class not found" }, { status: 404 });
    if (klass.ownerId !== userId) {
      return NextResponse.json({ error: "Only the owner can schedule sessions" }, { status: 403 });
    }

    const session = await createSession({
      classId: id,
      createdBy: userId,
      topic,
      date: body.date,
      time: body.time,
      maxStudents: Number(body.maxStudents),
      location: body.location,
      resource: body.resource,
      prompt: body.prompt,
      challenge: body.challenge,
    });
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not schedule the session." },
      { status: 502 }
    );
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const klass = await getClass(id);
    if (!klass) return NextResponse.json({ error: "Class not found" }, { status: 404 });
    if (klass.ownerId !== userId) {
      return NextResponse.json({ error: "Only the owner can cancel sessions" }, { status: 403 });
    }

    await cancelSession(id, sessionId);
    return NextResponse.json({ cancelled: sessionId });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not cancel the session." },
      { status: 502 }
    );
  }
}
