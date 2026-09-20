/**
 * POST /api/classes/join — a student joins with a code.
 *
 * Matches on the code, then reconciles: if they were invited by email the
 * existing row is upgraded to active rather than a second one being
 * written, so the roster never double-counts someone who both got an
 * invite and typed the code.
 */

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { addMember, findClassByCode } from "@/lib/classroom";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = String(body.code || "").trim().toUpperCase();
  if (code.length < 4) {
    return NextResponse.json({ error: "Enter the class code." }, { status: 400 });
  }

  try {
    const klass = await findClassByCode(code);
    if (!klass) {
      return NextResponse.json({ error: "No class with that code." }, { status: 404 });
    }

    const me = await currentUser().catch(() => null);
    const email = me?.emailAddresses?.[0]?.emailAddress?.toLowerCase() ?? null;
    const name =
      [me?.firstName, me?.lastName].filter(Boolean).join(" ") || me?.username || null;

    // Upgrade an email invite in place when there is one.
    await addMember({ classId: klass._id, email, status: "active" });
    await addMember({ classId: klass._id, userId, name, status: "active" });

    return NextResponse.json({ class: klass });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Could not join." },
      { status: 502 }
    );
  }
}
