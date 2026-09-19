/**
 * MongoDB setup — collections + indexes for LENS.
 * ─────────────────────────────────────────────────────────────────────
 * Run once per environment:  npm run db:setup
 * Then create the Atlas Search indexes:  npm run search:setup
 *
 * Owner: Person 4. Existing StudyO collections (users, sessions, sources,
 * chat_messages) keep their shape — LENS adds four:
 *
 *   events          every student action. The most important collection in
 *                   the product; the reasoning engine, the graph, and every
 *                   metric are derived from it.
 *   reasoning_states one row per inference about the student's model.
 *   camera_frames    derived observations only. The raw frame is never
 *                    persisted — see /api/vision/analyze.
 *   experiments      the Proof tier's hypothesis → prediction → outcome.
 */

import "dotenv/config";
import { getDb } from "./mongodb";

async function main() {
  const db = await getDb();
  console.log(`\n▸ Setting up "${db.databaseName}"\n`);

  // ── users ───────────────────────────────────────────────────────────
  const users = db.collection("users");
  await users.createIndex({ clerkId: 1 }, { unique: true });
  await users.createIndex({ email: 1 }, { unique: true, sparse: true });
  await users.createIndex({ createdAt: -1 });
  console.log("  ✓ users");

  // ── sessions ────────────────────────────────────────────────────────
  const sessions = db.collection("sessions");
  await sessions.createIndex({ userId: 1, updatedAt: -1 });
  await sessions.createIndex({ userId: 1, status: 1 });
  console.log("  ✓ sessions");

  // ── sources ─────────────────────────────────────────────────────────
  const sources = db.collection("sources");
  await sources.createIndex({ userId: 1, createdAt: -1 });
  await sources.createIndex({ sessionId: 1 });
  await sources.createIndex({ userId: 1, active: 1 });
  await sources.createIndex(
    { title: "text", extractedText: "text" },
    { name: "sources_text", weights: { title: 10, extractedText: 1 } }
  );
  console.log("  ✓ sources");

  // ── chat_messages ───────────────────────────────────────────────────
  const chat = db.collection("chat_messages");
  await chat.createIndex({ sessionId: 1, createdAt: 1 });
  await chat.createIndex({ userId: 1, createdAt: -1 });
  console.log("  ✓ chat_messages");

  // ── events (LENS) ───────────────────────────────────────────────────
  // sessionId+timestamp is the hot path: the reasoning engine reads the
  // last N events for one session on every single camera analysis.
  const events = db.collection("events");
  await events.createIndex({ sessionId: 1, timestamp: -1 });
  await events.createIndex({ sessionId: 1, type: 1 });
  await events.createIndex({ userId: 1, timestamp: -1 });
  await events.createIndex({ concept: 1 });
  console.log("  ✓ events");

  // ── reasoning_states (LENS) ─────────────────────────────────────────
  const reasoning = db.collection("reasoning_states");
  await reasoning.createIndex({ sessionId: 1, createdAt: -1 });
  await reasoning.createIndex({ sessionId: 1, misconception: 1 });
  console.log("  ✓ reasoning_states");

  // ── camera_frames (LENS) ────────────────────────────────────────────
  const frames = db.collection("camera_frames");
  await frames.createIndex({ sessionId: 1, createdAt: -1 });
  console.log("  ✓ camera_frames");

  // ── experiments (LENS) ──────────────────────────────────────────────
  const experiments = db.collection("experiments");
  await experiments.createIndex({ sessionId: 1, createdAt: -1 });
  await experiments.createIndex({ sessionId: 1, status: 1 });
  console.log("  ✓ experiments");

  // ── analytics_events ────────────────────────────────────────────────
  const analytics = db.collection("analytics_events");
  await analytics.createIndex({ userId: 1, createdAt: -1 });
  await analytics.createIndex({ event: 1, createdAt: -1 });
  console.log("  ✓ analytics_events");

  console.log("\n▸ Done. Next: npm run search:setup (Atlas vector index)\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("db:setup failed —", err);
  process.exit(1);
});
