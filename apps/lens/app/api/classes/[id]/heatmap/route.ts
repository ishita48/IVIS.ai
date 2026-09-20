/**
 * GET /api/classes/[id]/heatmap — when this class is actually studying.
 *
 * Replaces the invented "student availability" grid. LENS has never asked
 * anyone when they are free, so it cannot honestly display that; it does
 * know when they have been working, because every surface writes a
 * timestamped event.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { activityHeatmap, getClass, listMembers } from "@/lib/classroom";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  try {
    const klass = await getClass(id);
    if (!klass) return NextResponse.json({ error: "Class not found" }, { status: 404 });

    const members = await listMembers(id);
    const mine = members.find((m) => m.userId === userId && m.status !== "removed");
    if (!mine && klass.ownerId !== userId) {
      return NextResponse.json({ error: "Not your class" }, { status: 403 });
    }

    return NextResponse.json(await activityHeatmap(id));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not build the heatmap." },
      { status: 502 }
    );
  }
}
