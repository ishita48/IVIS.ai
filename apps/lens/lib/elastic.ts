import { embedText } from "./embeddings";

const INDEX = process.env.ELASTIC_INDEX || "lens-sources";
const DIMENSIONS = 1536;

type ElasticHit = {
  _id: string;
  _score?: number;
  _source?: Record<string, unknown>;
};

function configured() {
  return Boolean(process.env.ELASTIC_URL);
}

function headers() {
  const apiKey = process.env.ELASTIC_API_KEY;
  const username = process.env.ELASTIC_USERNAME;
  const password = process.env.ELASTIC_PASSWORD;
  const authorization = apiKey
    ? `ApiKey ${apiKey}`
    : username && password
    ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
    : undefined;

  return {
    "content-type": "application/json",
    ...(authorization ? { authorization } : {}),
  };
}

async function request(path: string, init?: RequestInit, allowNotFound = false) {
  if (!configured()) return null;
  const response = await fetch(`${process.env.ELASTIC_URL!.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers || {}) },
  });
  if (!response.ok && !(allowNotFound && response.status === 404)) {
    throw new Error(`Elastic ${response.status}: ${await response.text()}`);
  }
  return response;
}

export async function ensureElasticIndex() {
  if (!configured()) return false;
  const exists = await request(`/${INDEX}`, { method: "HEAD" }, true);
  if (exists?.status === 200) return true;

  await request(`/${INDEX}`, {
    method: "PUT",
    body: JSON.stringify({
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          sourceId: { type: "keyword" },
          userId: { type: "keyword" },
          sessionId: { type: "keyword" },
          title: { type: "text" },
          kind: { type: "keyword" },
          text: { type: "text" },
          chunk: { type: "integer" },
          embedding: {
            type: "dense_vector",
            dims: DIMENSIONS,
            index: true,
            similarity: "cosine",
          },
        },
      },
    }),
  });
  return true;
}

function chunks(text: string, size = 1800, overlap = 240) {
  const clean = text.replace(/\s+/g, " ").trim();
  const result: string[] = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    const part = clean.slice(start, start + size);
    if (part) result.push(part);
    if (start + size >= clean.length) break;
  }
  return result;
}

export function indexSourceInElastic(source: {
  id: string;
  userId: string;
  sessionId?: string | null;
  title: string;
  kind: string;
  text: string;
}) {
  if (!configured() || !source.text.trim()) return;
  void (async () => {
    try {
      await ensureElasticIndex();
      const parts = chunks(source.text);
      const lines: string[] = [];
      for (let i = 0; i < parts.length; i += 1) {
        const embedding = await embedText(`${source.title}\n${parts[i]}`);
        if (!embedding) continue;
        lines.push(JSON.stringify({ index: { _index: INDEX, _id: `${source.id}:${i}` } }));
        lines.push(
          JSON.stringify({
            sourceId: source.id,
            userId: source.userId,
            sessionId: source.sessionId ?? null,
            title: source.title,
            kind: source.kind,
            text: parts[i],
            chunk: i,
            embedding,
          })
        );
      }
      if (lines.length) {
        await request(`/${INDEX}/_bulk`, {
          method: "POST",
          headers: { "content-type": "application/x-ndjson" },
          body: `${lines.join("\n")}\n`,
        });
      }
    } catch (error) {
      console.warn("[elastic] source indexing skipped:", (error as Error).message);
    }
  })();
}

async function searchElastic(body: Record<string, unknown>) {
  const response = await request(`/${INDEX}/_search`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await response?.json();
  return (data?.hits?.hits || []) as ElasticHit[];
}

export async function hybridSearchElastic(opts: {
  userId: string;
  query: string;
  k?: number;
}) {
  if (!configured()) return [];
  const k = Math.max(1, Math.min(opts.k ?? 8, 25));
  const vector = await embedText(opts.query);
  if (!vector) return [];

  const [keywordHits, vectorHits] = await Promise.all([
    searchElastic({
      size: k,
      query: {
        bool: {
          must: [{ match: { text: { query: opts.query, fuzziness: "AUTO" } } }],
          filter: [{ term: { userId: opts.userId } }],
        },
      },
    }),
    searchElastic({
      size: k,
      knn: {
        field: "embedding",
        query_vector: vector,
        k,
        num_candidates: Math.max(50, k * 10),
        filter: { term: { userId: opts.userId } },
      },
    }),
  ]);

  const merged = new Map<string, { hit: ElasticHit; score: number }>();
  for (const [rank, hit] of keywordHits.entries()) {
    merged.set(hit._id, { hit, score: 1 / (60 + rank + 1) });
  }
  for (const [rank, hit] of vectorHits.entries()) {
    const current = merged.get(hit._id);
    const score = 1 / (60 + rank + 1);
    if (current) current.score += score;
    else merged.set(hit._id, { hit, score });
  }

  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ hit, score }) => ({ ...(hit._source || {}), _id: hit._id, score }));
}

export function elasticEnabled() {
  return configured();
}