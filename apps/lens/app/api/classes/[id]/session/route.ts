/**
 * POST /api/classes/[id]/session — the circle's shared workspace.
 *
 * A circle was a roster and nothing else: you could invite friends, they
 * could join, and then everyone worked alone. Joining landed you in your
 * own private /app, which made the whole feature a mailing list.
 *
 * This is the one session every member of a circle opens. It is an
 * ordinary session document with `classId` set, so every surface that
 * already reads a session — chat, sources, events, the reasoning tab, the
 * code tab — works on it unchanged. Nothing had to learn what a group is.
 *
 * THE ACCESS RULE IS THE WHOLE POINT. Sessions are filtered by userId
 * everywhere else, and that filter is what closed the cross-account leak
 * where one student could read another's session by guessing an id. A
 * shared session has to cross that line, so it crosses it on exactly one
 * check — canAccessClass — and only for a session that carries the
 * classId it is checked against. A member of circle A still cannot read
 * circle B, and nobody reads a private session that way at all.
 *
 * Get-or-create: the first member to open it creates it, everyone after
 * joins the same one. Racing on that is harmless because the id is derived
 * from the class, not generated — two simultaneous creates write the same
 * document rather than two rival rooms.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { canAccessClass, getClass } from "@/lib/classroom";
import { indexElasticDocument, queryElasticDocs } from "@/lib/elastic";

export const runtime = "nodejs";

/** Derived, not random, so concurrent first-opens converge on one room. */
function sharedSessionId(classId: string): string {
  return `circle-${classId}`;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: classId } = await ctx.params;

  if (!(await canAccessClass(classId, userId))) {
    // Deliberately not "not found": they asked about a real circle and the
    // honest answer is that they are not in it.
    return NextResponse.json(
      { error: "You are not a member of this circle." },
      { status: 403 }
    );
  }

  const klass = await getClass(classId).catch(() => null);
  if (!klass) return NextResponse.json({ error: "Circle not found." }, { status: 404 });

  const sessionId = sharedSessionId(classId);

  try {
    const existing = await queryElasticDocs<any>("sessions", {
      filter: [{ term: { _id: sessionId } }],
      size: 1,
    }).catch(() => null);

    if (existing?.length) {
      return NextResponse.json({
        sessionId,
        classId,
        title: existing[0].title ?? klass.name,
        joinCode: klass.joinCode,
        created: false,
      });
    }

    const now = new Date().toISOString();
    await indexElasticDocument("sessions", sessionId, {
      // The owner is the circle's owner, not whoever opened it first.
      // Otherwise the room would belong to whichever member was quickest.
      userId: klass.ownerId,
      classId,
      shared: true,
      title: klass.name,
      surface: "lens",
      sourceIds: [] as string[],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      sessionId,
      classId,
      title: klass.name,
      joinCode: klass.joinCode,
      created: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not open the group session." },
      { status: 502 }
    );
  }
}
