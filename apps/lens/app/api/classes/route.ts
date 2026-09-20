/**
 * /api/classes — a teacher's classes.
 *
 * GET   list the classes this user owns or belongs to
 * POST  create one { name, topic }
 *
 * Everything is stored in Elastic (lib/classroom.ts). There is no seeded
 * roster and no sample class: an account with no classes gets an empty
 * list, and the dashboard says so.
 */

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  classesForUser,
  classroomEnabled,
  createClass,
  listMembers,
} from "@/lib/classroom";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!classroomEnabled()) {
    return NextResponse.json(
      { error: "Classes need Elastic. Set ELASTIC_URL." },
      { status: 503 }
    );
  }

  try {
    const classes = await classesForUser(userId);
    const withCounts = await Promise.all(
      classes.map(async (c) => {
        const members = await listMembers(c._id);
        const active = members.filter((m) => m.status !== "removed");
        return {
          ...c,
          students: active.filter((m) => m.role === "student").length,
          isOwner: c.ownerId === userId,
        };
      })
    );
    return NextResponse.json({ classes: withCounts });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not load classes." },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { name?: string; topic?: string };
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "A class needs a name." }, { status: 400 });
  }

  try {
    const created = await createClass({ ownerId: userId, name, topic: body.topic });
    return NextResponse.json({ class: { ...created, students: 0, isOwner: true } });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not create the class." },
      { status: 502 }
    );
  }
}
