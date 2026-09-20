/**
 * Live vector search, for showing someone.  `npm run elastic:demo "your question"`
 * ─────────────────────────────────────────────────────────────────────
 *
 * Kibana can show the mapping and the documents, but it cannot easily show
 * the thing worth showing: that a query matching none of the words still
 * finds the right passage. Running a kNN search by hand in Dev Tools means
 * pasting 1,536 floats, which nobody is doing at a booth.
 *
 * So this embeds a question, runs BM25 and kNN over lens-sources, and
 * prints both rankings next to the fused one. The interesting column is
 * the one where BM25 finds nothing and the vector still lands on the right
 * passage — that is the whole argument for hybrid retrieval in one screen.
 *
 * It also prints the recalled misconceptions for the same query, which is
 * the part of this system that is actually unusual: kNN over what a
 * student believes rather than over what they read.
 */

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const URL_BASE = (process.env.ELASTIC_URL || "").replace(/\/$/, "");
const KEY = process.env.ELASTIC_API_KEY || "";

async function es(p: string, body?: unknown, method = "POST") {
  const res = await fetch(`${URL_BASE}${p}`, {
    method,
    headers: { authorization: `ApiKey ${KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as any;
}

function bar(score: number, max: number, width = 18) {
  const n = max > 0 ? Math.round((score / max) * width) : 0;
  return "█".repeat(Math.max(0, n)).padEnd(width, "·");
}

async function main() {
  const query = process.argv.slice(2).join(" ").trim() || "why does my loop stop too early";

  if (!URL_BASE || !KEY) {
    console.error("ELASTIC_URL and ELASTIC_API_KEY must be set in apps/lens/.env.local");
    process.exit(1);
  }

  // ── The index, plainly ────────────────────────────────────────────
  const cat = (await (
    await fetch(`${URL_BASE}/_cat/indices/lens-*?format=json`, {
      headers: { authorization: `ApiKey ${KEY}` },
    })
  ).json()) as any[];
  const total = cat.reduce((n, i) => n + Number(i["docs.count"] || 0), 0);

  const mapping = await es("/lens-sources/_mapping", undefined, "GET");
  const props = (Object.values(mapping)[0] as any)?.mappings?.properties ?? {};
  const vec = props.embedding ?? {};

  console.log(`\nElastic  ${URL_BASE.replace(/^https:\/\//, "").split(".")[0]}`);
  console.log(`indices  ${cat.length}, ${total} documents`);
  console.log(`vector   ${vec.type ?? "?"}  dims=${vec.dims ?? "?"}  similarity=${vec.similarity ?? "?"}`);
  console.log(`\nquery    "${query}"\n`);

  // ── Embed it with the same model the app uses ─────────────────────
  const { embedText } = await import("../lib/embeddings");
  const vector = await embedText(query);
  if (!vector) {
    console.error("Could not embed the query — check OPENAI_API_KEY.");
    process.exit(1);
  }

  // ── BM25 alone ────────────────────────────────────────────────────
  const kw = await es("/lens-sources/_search", {
    size: 4,
    query: { match: { text: { query, fuzziness: "AUTO" } } },
    _source: ["title", "text"],
  });
  const kwHits = kw.hits?.hits ?? [];

  console.log("BM25 — keywords only");
  if (!kwHits.length) {
    console.log("   no matches. None of these words appear in the corpus.\n");
  } else {
    const max = kwHits[0]._score;
    for (const h of kwHits) {
      console.log(
        `   ${bar(h._score, max)} ${h._score.toFixed(2).padStart(6)}  ${String(h._source.title).slice(0, 26)}`
      );
    }
    console.log();
  }

  // ── kNN alone ─────────────────────────────────────────────────────
  const knn = await es("/lens-sources/_search", {
    size: 4,
    knn: { field: "embedding", query_vector: vector, k: 4, num_candidates: 100 },
    _source: ["title", "text"],
  });
  const knnHits = knn.hits?.hits ?? [];

  console.log("kNN — meaning only   (cosine rescaled to 0.5–1.0)");
  for (const h of knnHits) {
    console.log(
      `   ${bar(h._score - 0.5, 0.5)} ${h._score.toFixed(3).padStart(6)}  ${String(h._source.title).slice(0, 26)}`
    );
  }
  if (knnHits[0]) {
    const t = String(knnHits[0]._source.text).replace(/\s+/g, " ").trim();
    console.log(`\n   top passage: "${t.slice(0, 150)}…"`);
  }

  // The line worth pointing at.
  if (!kwHits.length && knnHits.length) {
    console.log(
      `\n   ^ BM25 found nothing and kNN found ${knnHits.length}. That gap is why retrieval is hybrid.`
    );
  }

  // ── What the student already got wrong ────────────────────────────
  const mis = await es("/lens-mistakes/_search", {
    size: 3,
    knn: { field: "embedding", query_vector: vector, k: 3, num_candidates: 50 },
    _source: ["belief", "surface", "occurrences"],
  });
  const misHits = mis.hits?.hits ?? [];

  console.log(`\nlens-mistakes — recall by belief, not by document`);
  if (!misHits.length) {
    console.log("   nothing recorded close to this yet.");
  } else {
    for (const h of misHits) {
      const s = h._source;
      const mark = h._score >= 0.78 ? "SAME" : h._score >= 0.68 ? "near" : "    ";
      console.log(
        `   ${h._score.toFixed(3)} ${mark}  ${String(s.belief).slice(0, 62)}  (${s.surface}, ${s.occurrences}x)`
      );
    }
    console.log(`\n   0.68 worth mentioning · 0.78 same belief · 0.88 gate fires, model skipped`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
