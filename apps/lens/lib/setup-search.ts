/**
 * Provision Atlas Search + Vector Search indexes on the `sources` collection.
 *
 * Run once after creating your cluster:
 *   npm run search:setup
 *
 * Atlas applies search index changes asynchronously — the script will print
 * the index status it sees. Re-running is safe; if an index already exists
 * with the same definition it is a no-op.
 *
 * Requires Atlas (M0+ supports Search; M10+ recommended for Vector Search).
 */

import "dotenv/config";
import { MongoClient } from "mongodb";
import {
  EMBED_DIMS,
  SEARCH_INDEX,
  VECTOR_INDEX,
} from "./embeddings";

const VECTOR_INDEX_DEFINITION = {
  name: VECTOR_INDEX,
  type: "vectorSearch" as const,
  definition: {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: EMBED_DIMS,
        similarity: "cosine",
      },
      { type: "filter", path: "userId" },
      { type: "filter", path: "kind" },
      { type: "filter", path: "active" },
    ],
  },
};

const SEARCH_INDEX_DEFINITION = {
  name: SEARCH_INDEX,
  type: "search" as const,
  definition: {
    mappings: {
      dynamic: false,
      fields: {
        title: { type: "string", analyzer: "lucene.standard" },
        extractedText: { type: "string", analyzer: "lucene.standard" },
        kind: { type: "token" },
        userId: { type: "token" },
        active: { type: "boolean" },
      },
    },
  },
};

async function ensureIndex(
  client: MongoClient,
  dbName: string,
  collName: string,
  index: any
) {
  const db = client.db(dbName);
  const col = db.collection(collName);

  // listSearchIndexes is the canonical way to see what's there.
  const existing: any[] = await col.listSearchIndexes().toArray();
  const match = existing.find((e: any) => e.name === index.name);

  if (!match) {
    console.log(`  ➜  creating ${index.name} (${index.type})…`);
    await col.createSearchIndex(index);
    console.log(`  ✓  ${index.name} create requested (provisioning async)`);
    return;
  }

  console.log(
    `  ✓  ${index.name} already exists — status: ${match.status ?? "unknown"}`
  );
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "studio";
  if (!uri) {
    console.error("MONGODB_URI missing in .env");
    process.exit(1);
  }

  console.log(`▸ Connecting to ${dbName}…`);
  const client = new MongoClient(uri);
  await client.connect();

  try {
    console.log(`▸ Ensuring search indexes on '${dbName}.sources'`);
    await ensureIndex(client, dbName, "sources", VECTOR_INDEX_DEFINITION);
    await ensureIndex(client, dbName, "sources", SEARCH_INDEX_DEFINITION);

    console.log("\nDone. Atlas will finish provisioning in the background.");
    console.log("View status: Atlas UI → Search & Vector Search → Indexes\n");
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
