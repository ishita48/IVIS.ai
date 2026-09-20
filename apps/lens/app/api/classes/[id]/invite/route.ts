/**
 * POST /api/classes/[id]/invite — add students by email.
 *
 * Two things happen, and only one of them can fail: every address becomes
 * a membership row immediately, and then an email is attempted. So an
 * invite still "works" with no RESEND_API_KEY — the student is on the
 * roster and can join with the code — the teacher just has to pass the
 * link along themselves. The response says which of those happened.
 */

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { addMember, getClass } from "@/lib/classroom";
import { emailConfigured, sendInvites } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { emails?: unknown };

  // Accept a textarea: commas, semicolons, spaces or newlines.
  const raw = Array.isArray(body.emails)
    ? body.emails.map(String)
    : String(body.emails || "").split(/[\s,;]+/);
  const emails = Array.from(
    new Set(raw.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e)))
  ).slice(0, 50);

  if (!emails.length) {
    return NextResponse.json({ error: "No valid email addresses." }, { status: 400 });
  }

  try {
    const klass = await getClass(id);
    if (!klass) return NextResponse.json({ error: "Class not found" }, { status: 404 });
    if (klass.ownerId !== userId) {
      return NextResponse.json({ error: "Only the owner can invite" }, { status: 403 });
    }

    // Roster first. This is the part that must not depend on email.
    for (const email of emails) {
      await addMember({ classId: id, email, status: "invited" });
    }

    const origin = new URL(req.url).origin;
    const joinUrl = `${origin}/join/${klass.joinCode}`;

    const me = await currentUser().catch(() => null);
    const fromName =
      [me?.firstName, me?.lastName].filter(Boolean).join(" ") || me?.username || null;

    const results = await sendInvites({
      emails,
      className: klass.name,
      topic: klass.topic,
      joinCode: klass.joinCode,
      joinUrl,
      fromName,
    });

    return NextResponse.json({
      added: emails.length,
      emailConfigured: emailConfigured(),
      sent: results.filter((r) => r.sent).length,
      results,
      joinUrl,
      joinCode: klass.joinCode,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not invite." },
      { status: 502 }
    );
  }
}
