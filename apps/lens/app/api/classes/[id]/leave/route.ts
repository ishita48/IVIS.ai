/**
 * POST /api/classes/[id]/leave — take yourself out of a circle.
 *
 * Membership rows are soft-deleted, the same way removeMember does it for
 * a teacher removing a student, so the history a person leaves behind in a
 * shared room stays attributable rather than turning into events from
 * nobody.
 *
 * Leaving costs them the room: once the row reads `removed`,
 * canAccessClass says no, the room drops out of their sidebar, and
 * resolveOrCreateSession stops handing it over. Their own private sessions
 * are untouched.
 *
 * The owner cannot leave. A circle with no owner has nobody who can invite
 * or remove anyone, and the honest fix for "I don't want this circle" is
 * deleting it — which is a different, more destructive thing than walking
 * out, and is not silently done here.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getClass, listMembers, removeMember } from "@/lib/classroom";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: classId } = await ctx.params;

  try {
    const klass = await getClass(classId);
    if (!klass) return NextResponse.json({ error: "Circle not found." }, { status: 404 });

    if (klass.ownerId === userId) {
      return NextResponse.json(
        {
          error:
            "You created this circle, so you can't leave it — nobody would be left to manage it.",
        },
        { status: 409 }
      );
    }

    const mine = (await listMembers(classId)).filter(
      (m) => m.userId === userId && m.status !== "removed"
    );

    if (!mine.length) {
      // Already out. Saying so beats a 404 that reads like the circle is gone.
      return NextResponse.json({ left: true, already: true, name: klass.name });
    }

    // A person can hold more than one row here: an email invite and the
    // account that later claimed it. Both have to go or they stay in.
    for (const m of mine) await removeMember(classId, m._id);

    return NextResponse.json({ left: true, name: klass.name, removed: mine.length });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not leave the circle." },
      { status: 502 }
    );
  }
}
