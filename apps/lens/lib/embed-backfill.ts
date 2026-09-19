/**
 * Backfill embeddings for all sources missing them.
 * Run: npx tsx lib/embed-backfill.ts
 *
 * Useful after first deploying vector search, or after adding sources
 * before the embedding pipeline existed.
 */

import "dotenv/config";
import { getDb } from "./mongodb";
import { embedText, EMBED_MODEL } from "./embeddings";

async function main() {
  const db = await getDb();
  const cursor = db
    .collection("sources")
    .find({ embedding: null }, { projection: { _id: 1, title: 1, extractedText: 1 } });

  let done = 0;
  let skipped = 0;
  for await (const doc of cursor) {
    const text = doc.extractedText || "";
    if (!text.trim()) {
      skipped++;
      continue;
    }
    const body = [doc.title, text].filter(Boolean).join("\n\n");
    const vec = await embedText(body);
    if (!vec) {
      skipped++;
      continue;
    }
    await db.collection("sources").updateOne(
      { _id: doc._id },
      {
        $set: {
          embedding: vec,
          embeddingModel: EMBED_MODEL,
          embeddedAt: new Date(),
        },
      }
    );
    done++;
    if (done % 10 === 0) console.log(`  embedded ${done} so far…`);
  }

  console.log(`\nDone. embedded=${done}, skipped=${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
