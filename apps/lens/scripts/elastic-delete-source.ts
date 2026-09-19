/**
 * Remove one source from Elastic by its title (e.g. a test file that should not be searchable).
 *
 *   npx tsx scripts/elastic-delete-source.ts hello          # dry run: shows what it would delete
 *   npx tsx scripts/elastic-delete-source.ts hello --yes    # actually deletes
 *
 * Matches the title EXACTLY (case-insensitive) so "hello" cannot remove "Hello World Lecture".
 * Only touches the Elastic copy; the source in Mongo is not changed.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const url = (process.env.ELASTIC_URL || "").replace(/\/$/, "");
const index = process.env.ELASTIC_INDEX || "lens-sources";
if (!url) throw new Error("ELASTIC_URL is not set in apps/lens/.env.local");
const title = process.argv[2];
const really = process.argv.includes("--yes");
if (!title || title.startsWith("--")) throw new Error('usage: npx tsx scripts/elastic-delete-source.ts "<title>" [--yes]');

const headers: Record<string, string> = { "content-type": "application/json" };
if (process.env.ELASTIC_API_KEY) headers.authorization = `ApiKey ${process.env.ELASTIC_API_KEY}`;
else if (process.env.ELASTIC_USERNAME && process.env.ELASTIC_PASSWORD)
  headers.authorization = "Basic " + Buffer.from(`${process.env.ELASTIC_USERNAME}:${process.env.ELASTIC_PASSWORD}`).toString("base64");

async function es(path: string, body: unknown) {
  const res = await fetch(`${url}/${index}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Elastic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<any>;
}

async function main() {
  // title is a "text" field, so match_phrase finds candidates; we then keep only exact (case-insensitive) matches.
  const found = await es("/_search", { size: 200, _source: ["title", "sourceId", "chunk"], query: { match_phrase: { title } } });
  const exact = (found.hits.hits as any[]).filter((h) => String(h._source.title).trim().toLowerCase() === title.trim().toLowerCase());
  console.log(`${exact.length} chunk(s) titled exactly "${title}" in "${index}"`);
  for (const h of exact.slice(0, 10)) console.log(`  - ${h._id}  (source ${h._source.sourceId}, chunk ${h._source.chunk})`);
  if (!exact.length) return;
  if (!really) return console.log("\nDry run. Add --yes to delete these.");
  const ids = exact.map((h) => h._id);
  const del = await es("/_delete_by_query?refresh=true", { query: { ids: { values: ids } } });
  console.log(`\nDeleted ${del.deleted} chunk(s).`);
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
