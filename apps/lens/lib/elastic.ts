const INDEX = process.env.ELASTIC_INDEX || "lens-sources";
const EVENTS_INDEX = process.env.ELASTIC_EVENTS_INDEX || "lens-events";
const REASONING_INDEX = process.env.ELASTIC_REASONING_INDEX || "lens-reasoning";
const DIMENSIONS = 1536;

type ElasticHit = {
  _id: string;
  _score?: number;
  _source?: Record<string, unknown>;
};

async function embedForElastic(text: string) {
  const { embedText } = await import("./embeddings");
  return embedText(text);
}

function configured() {
  return Boolean(process.env.ELASTIC_URL);
}

export function elasticPrimary() {
  return configured() && process.env.ELASTIC_PRIMARY !== "false";
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
  void indexSourceInElasticNow(source).catch((error) => {
    console.warn("[elastic] source indexing skipped:", (error as Error).message);
  });
}

export async function indexSourceInElasticNow(source: {
  id: string;
  userId: string;
  sessionId?: string | null;
  title: string;
  kind: string;
  text: string;
}) {
  if (!configured() || !source.text.trim()) return 0;
  await ensureElasticIndex();
  const parts = chunks(source.text);
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const embedding = await embedForElastic(`${source.title}\n${parts[i]}`);
    if (!embedding) continue;
    lines.push(JSON.stringify({ index: { _index: INDEX, _id: `${source.id}:${i}` } }));
    lines.push(JSON.stringify({
      sourceId: source.id,
      userId: source.userId,
      sessionId: source.sessionId ?? null,
      title: source.title,
      kind: source.kind,
      text: parts[i],
      chunk: i,
      embedding,
      indexedAt: new Date().toISOString(),
    }));
  }
  if (lines.length) {
    await request(`/${INDEX}/_bulk`, {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body: `${lines.join("\n")}\n`,
    });
  }
  return lines.length / 2;
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
  /** Restrict to these sources (e.g. the active ones in the current session). */
  sourceIds?: string[];
}) {
  if (!configured()) return [];
  const k = Math.max(1, Math.min(opts.k ?? 8, 25));
  const vector = await embedForElastic(opts.query);
  if (!vector) return [];

  const filters: Record<string, unknown>[] = [{ term: { userId: opts.userId } }];
  if (opts.sourceIds) filters.push({ terms: { sourceId: opts.sourceIds } });

  const [keywordHits, vectorHits] = await Promise.all([
    searchElastic({
      size: k,
      query: {
        bool: {
          must: [{ match: { text: { query: opts.query, fuzziness: "AUTO" } } }],
          filter: filters,
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
        filter: filters,
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

async function ensureDocumentIndex(index: string, properties: Record<string, unknown>) {
  if (!configured()) return false;
  const exists = await request(`/${index}`, { method: "HEAD" }, true);
  if (exists?.status === 200) return true;
  await request(`/${index}`, {
    method: "PUT",
    body: JSON.stringify({
      mappings: { dynamic: true, properties },
    }),
  });
  return true;
}

export async function ensureElasticSystemIndices() {
  await Promise.all([
    ensureDocumentIndex(EVENTS_INDEX, {
      sessionId: { type: "keyword" },
      userId: { type: "keyword" },
      type: { type: "keyword" },
      concept: { type: "keyword" },
      timestamp: { type: "date" },
    }),
    ensureDocumentIndex(REASONING_INDEX, {
      sessionId: { type: "keyword" },
      userId: { type: "keyword" },
      createdAt: { type: "date" },
      nextAction: { type: "keyword" },
      hintLevel: { type: "keyword" },
      misconception: { type: "text" },
    }),
  ]);
}

export async function indexElasticDocument(
  index: "events" | "reasoning",
  id: string,
  document: Record<string, unknown>
) {
  if (!elasticPrimary()) return false;
  const target = index === "events" ? EVENTS_INDEX : REASONING_INDEX;
  await ensureDocumentIndex(target, {});
  await request(`/${target}/_doc/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(document),
  });
  return true;
}

export async function searchElasticDocuments<T>(
  index: "events" | "reasoning",
  sessionId: string,
  limit: number,
  ascending = false
) {
  if (!elasticPrimary()) return null;
  const target = index === "events" ? EVENTS_INDEX : REASONING_INDEX;
  const sortField = index === "events" ? "timestamp" : "createdAt";
  const response = await request(`/${target}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size: limit,
      query: { term: { sessionId } },
      sort: [{ [sortField]: ascending ? "asc" : "desc" }],
    }),
  });
  const data = await response?.json();
  return ((data?.hits?.hits || []) as ElasticHit[]).map(
    (hit) => ({ _id: hit._id, ...(hit._source || {}) }) as T
  );
}

export async function listElasticSources(opts: { userId: string; sessionId?: string | null }) {
  if (!elasticPrimary()) return null;
  const filters: Record<string, unknown>[] = [{ term: { userId: opts.userId } }];
  if (opts.sessionId) filters.push({ term: { sessionId: opts.sessionId } });
  const response = await request(`/${INDEX}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size: 200,
      query: { bool: { filter: filters } },
      collapse: { field: "sourceId" },
      sort: [{ indexedAt: "desc" }],
    }),
  });
  const data = await response?.json();
  return ((data?.hits?.hits || []) as ElasticHit[]).map((hit) => {
    const source = hit._source || {};
    return {
      _id: String(source.sourceId || hit._id),
      userId: source.userId,
      sessionId: source.sessionId ?? null,
      title: source.title,
      kind: source.kind,
      extractedText: String(source.text || "").slice(0, 240),
      active: true,
      metadata: { provider: "elastic" },
    };
  });
}