/**
 * GET /api/classes/[id]/activity — the live panel, computed.
 *
 * Every number here is a query over `lens-events`: who has been active in
 * the last fifteen minutes, the tutor's most recent read of each student's
 * understanding, and the questions they actually asked out loud. Nothing
 * is sampled from a constant, and a quiet class returns zeros rather than
 * a plausible-looking split.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getClass, listMembers, liveActivity } from "@/lib/classroom";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  try {
    const klass = await getClass(id);
    if (!klass) return NextResponse.json({ error: "Class not found" }, { status: 404 });

    // Membership is the permission check: you see a class you belong to.
    const members = await listMembers(id);
    const mine = members.find((m) => m.userId === userId && m.status !== "removed");
    if (!mine && klass.ownerId !== userId) {
      return NextResponse.json({ error: "Not your class" }, { status: 403 });
    }

    const activity = await liveActivity(id);
    return NextResponse.json({
      class: klass,
      activity,
      members: members
        .filter((m) => m.status !== "removed")
        .map((m) => ({
          id: m._id,
          name: m.name,
          email: m.email,
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt,
        })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not read class activity." },
      { status: 502 }
    );
  }
}
