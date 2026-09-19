import { auth, currentUser } from "@clerk/nextjs/server";
import { getDb } from "@/lib/mongodb";
import { trackEvent } from "@/lib/aggregations";
import { NextResponse } from "next/server";

// Always hit the DB — onboarding/tour completion flags must never be served
// from a stale cached response, otherwise a user that completed the quiz
// once will keep seeing it after sign-out/sign-in or group-page navigation.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function noStore(res: NextResponse) {
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );
  res.headers.set("Pragma", "no-cache");
  return res;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const now = new Date();

  // Mongo rejects $set of "stats.lastActiveAt" alongside $setOnInsert of the
  // whole "stats" object — it's a path conflict. Fix: upsert identity fields
  // first, then bump stats.lastActiveAt in a separate update (safe because
  // the doc is guaranteed to exist by the time we hit the second call).
  await db.collection("users").updateOne(
    { clerkId: user.id },
    {
      $set: {
        email: user.emailAddresses[0]?.emailAddress ?? "",
        name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || null,
        imageUrl: user.imageUrl,
        updatedAt: now,
      },
      $setOnInsert: {
        clerkId: user.id,
        createdAt: now,
        preferences: {
          theme: "system",
          flashcardMode: "spaced-repetition",
          voiceEnabled: true,
          defaultView: "flashcards",
        },
        stats: {
          totalSessions: 0,
          totalFlashcards: 0,
          totalQuizzes: 0,
          studyStreak: 0,
          lastActiveAt: now,
          totalStudyTimeMs: 0,
        },
      },
    },
    { upsert: true }
  );

  const result = await db.collection("users").findOneAndUpdate(
    { clerkId: user.id },
    { $set: { "stats.lastActiveAt": now } },
    { returnDocument: "after" }
  );

  await trackEvent(user.id, "user_login", {
    provider: user.externalAccounts?.[0]?.provider ?? "email",
  });

  return noStore(NextResponse.json(result));
}

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return noStore(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  const body = await req.json();
  const db = await getDb();

  const updateFields: Record<string, any> = { updatedAt: new Date() };
  if (body.preferences) {
    for (const [key, value] of Object.entries(body.preferences)) {
      updateFields[`preferences.${key}`] = value;
    }
  }

  // Upsert so a PATCH can never silently 404 on a brand-new user whose row
  // hasn't been materialised yet (race between Clerk session + first GET).
  // Without this, completing the onboarding quiz on a fresh account quietly
  // failed to persist and the quiz re-appeared on every sign-in.
  const result = await db.collection("users").findOneAndUpdate(
    { clerkId: userId },
    {
      $set: updateFields,
      $setOnInsert: { clerkId: userId, createdAt: new Date() },
    },
    { returnDocument: "after", upsert: true }
  );

  return noStore(NextResponse.json(result));
}