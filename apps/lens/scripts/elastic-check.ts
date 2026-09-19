/**
 * Is my Dropbox import actually searchable in Elastic?
 *
 *   cd apps/lens && npx tsx scripts/elastic-check.ts "propositions"
 *
 * Prints how many chunks are indexed per source, then a keyword search for the word you pass.
 * Never prints embeddings or keys.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const url = (process.env.ELASTIC_URL || "").replace(/\/$/, "");
const index = process.env.ELASTIC_INDEX || "lens-sources";
if (!url) throw new Error("ELASTIC_URL is not set in apps/lens/.env.local");

const headers: Record<string, string> = { "content-type": "application/json" };
if (process.env.ELASTIC_API_KEY) headers.authorization = `ApiKey ${process.env.ELASTIC_API_KEY}`;
else if (process.env.ELASTIC_USERNAME && process.env.ELASTIC_PASSWORD)
  headers.authorization = "Basic " + Buffer.from(`${process.env.ELASTIC_USERNAME}:${process.env.ELASTIC_PASSWORD}`).toString("base64");

async function es(path: string, body?: unknown) {
  const res = await fetch(`${url}/${index}${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Elastic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<any>;
}

async function main() {
  const word = process.argv[2] || "the";
  await es("/_refresh", {}).catch(() => {});

  const agg = await es("/_search", {
    size: 0,
    aggs: { bySource: { terms: { field: "sourceId", size: 50 }, aggs: { t: { top_hits: { size: 1, _source: ["title", "kind"] } } } } },
  });
  const buckets: any[] = agg.aggregations?.bySource?.buckets ?? [];
  console.log(`index "${index}": ${agg.hits.total.value} chunk(s) across ${buckets.length} source(s)`);
  for (const b of buckets) console.log(`  - ${b.t.hits.hits[0]?._source?.title ?? b.key}: ${b.doc_count} chunk(s)`);
  if (!buckets.length) console.log("  (nothing indexed yet: see the hints below)");

  const hits = await es("/_search", { size: 3, _source: ["title", "text", "chunk"], query: { match: { text: word } } });
  console.log(`\nkeyword search for "${word}": ${hits.hits.total.value} hit(s)`);
  for (const h of hits.hits.hits) {
    const s = h._source;
    console.log(`  [${s.title} #${s.chunk}] ${String(s.text).replace(/\s+/g, " ").slice(0, 140)}...`);
  }
  if (!buckets.length) {
    console.log("\nIf nothing is indexed: (1) the import ran before Elastic/OpenAI were configured -> re-import with a changed file, or");
    console.log("(2) OPENAI_API_KEY is missing/invalid, so embeddings failed and Elastic skipped the chunks. Check the server log for '[elastic] source indexing skipped'.");
  }
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
