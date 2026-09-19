import { getDb } from "@/lib/mongodb";
import { NextResponse } from "next/server";
import { Webhook } from "svix";

export const runtime = "nodejs";

// Clerk → Mongo sync, signed with Svix. Required env: CLERK_WEBHOOK_SECRET
// Configure at https://dashboard.clerk.com/last-active?path=webhooks
export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  // Clerk sends these headers
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing Svix headers" }, { status: 400 });
  }

  const payload = await req.text();
  let evt: any;
  try {
    const wh = new Webhook(secret);
    evt = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (e: any) {
    console.error("[clerk-webhook] signature verification failed", e?.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { type, data } = evt;
  const db = await getDb();
  const now = new Date();

  switch (type) {
    case "user.created":
      await db.collection("users").updateOne(
        { clerkId: data.id },
        {
          $setOnInsert: {
            clerkId: data.id,
            email: data.email_addresses?.[0]?.email_address ?? "",
            name:
              `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || null,
            imageUrl: data.image_url ?? null,
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
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
      break;

    case "user.updated":
      await db.collection("users").updateOne(
        { clerkId: data.id },
        {
          $set: {
            email: data.email_addresses?.[0]?.email_address ?? "",
            name:
              `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || null,
            imageUrl: data.image_url ?? null,
            updatedAt: now,
          },
        }
      );
      break;

    case "user.deleted": {
      const user = await db.collection("users").findOne({ clerkId: data.id });
      if (user) {
        await Promise.all([
          db.collection("sessions").deleteMany({ userId: data.id }),
          db.collection("sources").deleteMany({ userId: data.id }),
          db.collection("flashcards").deleteMany({ userId: data.id }),
          db.collection("quizzes").deleteMany({ userId: data.id }),
          db.collection("quiz_attempts").deleteMany({ userId: data.id }),
          db.collection("concept_maps").deleteMany({ userId: data.id }),
          db.collection("summaries").deleteMany({ userId: data.id }),
          db.collection("chat_messages").deleteMany({ userId: data.id }),
          db.collection("analytics").deleteMany({ userId: data.id }),
          db.collection("users").deleteOne({ clerkId: data.id }),
        ]);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
