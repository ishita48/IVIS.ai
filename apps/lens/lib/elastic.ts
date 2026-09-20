const INDEX = process.env.ELASTIC_INDEX || "lens-sources";
const EVENTS_INDEX = process.env.ELASTIC_EVENTS_INDEX || "lens-events";
const REASONING_INDEX = process.env.ELASTIC_REASONING_INDEX || "lens-reasoning";
const SESSIONS_INDEX = process.env.ELASTIC_SESSIONS_INDEX || "lens-sessions";
const MISTAKES_INDEX = process.env.ELASTIC_MISTAKES_INDEX || "lens-mistakes";
const CONCEPT_MAPS_INDEX = process.env.ELASTIC_CONCEPT_MAPS_INDEX || "lens-concept-maps";
const CHAT_MESSAGES_INDEX = process.env.ELASTIC_CHAT_MESSAGES_INDEX || "lens-chat-messages";
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
  url?: string | null;
  active?: boolean;
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
  /** Carried so the panel can link out to a video or page. */
  url?: string | null;
  /** Muted sources stay indexed but are excluded from retrieval. */
  active?: boolean;
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
      url: source.url ?? null,
      active: source.active !== false,
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

  // Rank fusion only orders results; it says nothing about match quality.
  // Keep each list's raw score (BM25 / knn similarity) so callers can judge
  // relevance. A passage missing from a list has no score for it.
  const merged = new Map<
    string,
    { hit: ElasticHit; score: number; keywordScore?: number; vectorScore?: number }
  >();
  for (const [rank, hit] of keywordHits.entries()) {
    merged.set(hit._id, {
      hit,
      score: 1 / (60 + rank + 1),
      keywordScore: hit._score,
    });
  }
  for (const [rank, hit] of vectorHits.entries()) {
    const current = merged.get(hit._id);
    const score = 1 / (60 + rank + 1);
    if (current) {
      current.score += score;
      current.vectorScore = hit._score;
    } else merged.set(hit._id, { hit, score, vectorScore: hit._score });
  }

  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ hit, score, keywordScore, vectorScore }) => ({
      ...(hit._source || {}),
      _id: hit._id,
      score,
      keywordScore,
      vectorScore,
    }));
}

export function elasticEnabled() {
  return configured();
}

/** The plain-document indices, as opposed to the vector ones. */
export type ElasticDocIndex = "events" | "reasoning" | "sessions" | "mistakes" | "conceptMaps" | "chatMessages";

const DOC_INDEX: Record<ElasticDocIndex, string> = {
  events: EVENTS_INDEX,
  reasoning: REASONING_INDEX,
  sessions: SESSIONS_INDEX,
  mistakes: MISTAKES_INDEX,
  conceptMaps: CONCEPT_MAPS_INDEX,
  chatMessages: CHAT_MESSAGES_INDEX,
};

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
    ensureDocumentIndex(SESSIONS_INDEX, {
      userId: { type: "keyword" },
      title: { type: "text" },
      surface: { type: "keyword" },
      createdAt: { type: "date" },
      updatedAt: { type: "date" },
    }),
    // Mistake memory. The embedding is of the BELIEF, not the artifact, so
    // the same misconception reached through a circuit and through a quiz
    // lands in the same neighbourhood.
    ensureDocumentIndex(MISTAKES_INDEX, {
      userId: { type: "keyword" },
      sessionId: { type: "keyword" },
      surface: { type: "keyword" },
      concept: { type: "keyword" },
      belief: { type: "text" },
      rootCause: { type: "text" },
      evidence: { type: "text" },
      sourceTitle: { type: "keyword" },
      resolved: { type: "boolean" },
      occurrences: { type: "integer" },
      firstSeenAt: { type: "date" },
      createdAt: { type: "date" },
      embedding: {
        type: "dense_vector",
        dims: DIMENSIONS,
        index: true,
        similarity: "cosine",
      },
    }),
    ensureDocumentIndex(CONCEPT_MAPS_INDEX, {
      sessionId: { type: "keyword" },
      userId: { type: "keyword" },
      updatedAt: { type: "date" },
    }),
    ensureDocumentIndex(CHAT_MESSAGES_INDEX, {
      sessionId: { type: "keyword" },
      userId: { type: "keyword" },
      role: { type: "keyword" },
      createdAt: { type: "date" },
    }),
  ]);
}

export async function indexElasticDocument(
  index: ElasticDocIndex,
  id: string,
  document: Record<string, unknown>,
  /**
   * Default "wait_for" rather than false, because almost everything here
   * reads its own write moments later: mistake dedupe does a kNN lookup
   * against beliefs it may have just stored, the metrics strip aggregates
   * events recorded seconds ago, and a saved session is listed right after
   * saving. With the default refresh interval those reads silently miss
   * and the feature looks broken rather than slow. "wait_for" piggybacks
   * on the next scheduled refresh instead of forcing a flush per document.
   */
  refresh: "wait_for" | "true" | "false" = "wait_for"
) {
  if (!elasticPrimary()) return false;
  const target = DOC_INDEX[index];
  await ensureDocumentIndex(target, {});
  await request(
    `/${target}/_doc/${encodeURIComponent(id)}?refresh=${refresh}`,
    {
      method: "PUT",
      body: JSON.stringify(document),
    }
  );
  return true;
}

/**
 * Vector search over one of the document indices.
 *
 * `num_candidates` is deliberately well above k: Elastic's HNSW is
 * approximate, and a narrow candidate pool is how a near-identical
 * misconception gets missed and recorded as a brand-new one.
 */
export async function knnSearchDocs<T>(
  index: ElasticDocIndex,
  opts: {
    embedding: number[];
    k?: number;
    filter?: Record<string, unknown>[];
    minScore?: number;
  }
): Promise<(T & { _score: number })[] | null> {
  if (!elasticPrimary()) return null;
  const k = opts.k ?? 5;
  await ensureDocumentIndex(DOC_INDEX[index], {});

  const response = await request(`/${DOC_INDEX[index]}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size: k,
      knn: {
        field: "embedding",
        query_vector: opts.embedding,
        k,
        num_candidates: Math.max(50, k * 10),
        ...(opts.filter?.length ? { filter: { bool: { filter: opts.filter } } } : {}),
      },
      _source: { excludes: ["embedding"] },
      ...(opts.minScore ? { min_score: opts.minScore } : {}),
    }),
  });

  const data = await response?.json();
  return ((data?.hits?.hits || []) as ElasticHit[]).map(
    (hit) =>
      ({ _id: hit._id, _score: hit._score ?? 0, ...(hit._source || {}) }) as unknown as T & {
        _score: number;
      }
  );
}

/** Merge fields into an existing document without rewriting it. */
export async function updateElasticDoc(
  index: ElasticDocIndex,
  id: string,
  fields: Record<string, unknown>
) {
  if (!elasticPrimary()) return false;
  await request(`/${DOC_INDEX[index]}/_update/${encodeURIComponent(id)}?refresh=true`, {
    method: "POST",
    body: JSON.stringify({ doc: fields }),
  });
  return true;
}

/** Generic filtered fetch from one of the document indices. */
export async function queryElasticDocs<T>(
  index: ElasticDocIndex,
  opts: { filter: Record<string, unknown>[]; size?: number; sort?: Record<string, unknown>[] }
): Promise<T[] | null> {
  if (!elasticPrimary()) return null;
  await ensureDocumentIndex(DOC_INDEX[index], {});
  const response = await request(`/${DOC_INDEX[index]}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size: opts.size ?? 20,
      query: { bool: { filter: opts.filter } },
      ...(opts.sort ? { sort: opts.sort } : {}),
    }),
  });
  const data = await response?.json();
  return ((data?.hits?.hits || []) as ElasticHit[]).map(
    (hit) => ({ _id: hit._id, ...(hit._source || {}) }) as T
  );
}

export async function searchElasticDocuments<T>(
  index: ElasticDocIndex,
  sessionId: string,
  limit: number,
  ascending = false,
  type?: string
) {
  if (!elasticPrimary()) return null;
  const target = DOC_INDEX[index];
  const sortField = index === "events" ? "timestamp" : "createdAt";
  const response = await request(`/${target}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size: limit,
      query: type
        ? { bool: { filter: [{ term: { sessionId } }, { term: { type } }] } }
        : { term: { sessionId } },
      sort: [{ [sortField]: ascending ? "asc" : "desc" }],
    }),
  });
  const data = await response?.json();
  return ((data?.hits?.hits || []) as ElasticHit[]).map(
    (hit) => ({ _id: hit._id, ...(hit._source || {}) }) as T
  );
}

/**
 * Events for one user, optionally narrowed to a session or a type.
 *
 * `searchElasticDocuments` above is session-scoped and does not filter by
 * owner; this one always does, which is what makes it safe to hand a
 * sessionId straight off a URL.
 */
export async function queryElasticEvents<T>(opts: {
  userId: string;
  sessionId?: string;
  types?: string[];
  limit?: number;
  ascending?: boolean;
}) {
  if (!elasticPrimary()) return null;
  const filter: Record<string, unknown>[] = [{ term: { userId: opts.userId } }];
  if (opts.sessionId) filter.push({ term: { sessionId: opts.sessionId } });
  if (opts.types?.length) filter.push({ terms: { type: opts.types } });

  const response = await request(`/${EVENTS_INDEX}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size: opts.limit ?? 500,
      query: { bool: { filter } },
      sort: [{ timestamp: opts.ascending === false ? "desc" : "asc" }],
    }),
  });

  const data = await response?.json();
  return ((data?.hits?.hits || []) as ElasticHit[]).map(
    (hit) => ({ _id: hit._id, ...(hit._source || {}) }) as T
  );
}

/**
 * Every session this user has events for, newest activity first.
 *
 * One terms aggregation, not one query per session — the saved-sessions
 * list is a single round trip however many sessions there are. `sessionId`
 * and `userId` are mapped `keyword` (see ensureElasticSystemIndices), which
 * is what makes the bucket key exact rather than an analyzed token.
 */
export async function aggregateElasticSessions(opts: {
  userId: string;
  limit?: number;
}) {
  if (!elasticPrimary()) return null;
  const response = await request(`/${EVENTS_INDEX}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size: 0,
      query: { bool: { filter: [{ term: { userId: opts.userId } }] } },
      aggs: {
        sessions: {
          terms: {
            field: "sessionId",
            size: opts.limit ?? 50,
            order: { last: "desc" },
          },
          aggs: {
            first: { min: { field: "timestamp" } },
            last: { max: { field: "timestamp" } },
            types: { terms: { field: "type", size: 20 } },
          },
        },
      },
    }),
  });

  const data = await response?.json();
  const buckets = (data?.aggregations?.sessions?.buckets || []) as {
    key: string;
    doc_count: number;
    first: { value: number };
    last: { value: number };
    types: { buckets: { key: string; doc_count: number }[] };
  }[];

  return buckets.map((bucket) => ({
    sessionId: bucket.key,
    eventCount: bucket.doc_count,
    firstAt: bucket.first?.value ?? 0,
    lastAt: bucket.last?.value ?? 0,
    byType: Object.fromEntries(
      (bucket.types?.buckets || []).map((t) => [t.key, t.doc_count])
    ) as Record<string, number>,
  }));
}

/**
 * The Sources panel, served from Elastic.
 * ─────────────────────────────────────────────────────────────────────
 * Sources are stored CHUNKED — one document per passage, all sharing a
 * `sourceId`. Everything below collapses on that field so the panel shows
 * one row per file rather than one row per paragraph, while search still
 * ranks on the passage that actually matched.
 */
export type ElasticSourceRow = {
  _id: string;
  sourceId: string;
  title: string;
  kind: string;
  url?: string | null;
  sessionId?: string | null;
  active: boolean;
  chunks: number;
  indexedAt?: string;
  /** The passage that matched, when this came from a search. */
  snippet?: string | null;
  score?: number;
};

function rowFromHit(hit: any): ElasticSourceRow {
  const src = hit._source || {};
  const inner = hit.inner_hits?.all?.hits;
  return {
    _id: String(src.sourceId || hit._id),
    sourceId: String(src.sourceId || hit._id),
    title: src.title || "Untitled",
    kind: src.kind || "webpage",
    url: src.url ?? null,
    sessionId: src.sessionId ?? null,
    active: src.active !== false,
    chunks: inner?.total?.value ?? 1,
    indexedAt: src.indexedAt,
    snippet:
      (hit.highlight?.text?.[0] as string | undefined) ??
      (typeof src.text === "string" ? src.text.slice(0, 220) : null),
    score: hit._score ?? undefined,
  };
}

const sourceFilters = (opts: {
  userId: string;
  sessionId?: string | null;
  kind?: string | null;
  activeOnly?: boolean;
}) => {
  const filter: Record<string, unknown>[] = [{ term: { userId: opts.userId } }];
  if (opts.sessionId) filter.push({ term: { sessionId: opts.sessionId } });
  if (opts.kind) filter.push({ term: { kind: opts.kind } });
  return filter;
};

/** One row per source, newest first, optionally narrowed to a kind. */
export async function listSourcesElastic(opts: {
  userId: string;
  sessionId?: string | null;
  kind?: string | null;
  limit?: number;
}): Promise<ElasticSourceRow[] | null> {
  if (!configured()) return null;
  const response = await request(`/${INDEX}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size: opts.limit ?? 200,
      query: { bool: { filter: sourceFilters(opts) } },
      collapse: { field: "sourceId", inner_hits: { name: "all", size: 0 } },
      sort: [{ indexedAt: "desc" }],
      _source: { excludes: ["embedding"] },
    }),
  });
  const data = await response?.json();
  return ((data?.hits?.hits || []) as any[]).map(rowFromHit);
}

/** How many sources of each kind — the filter chips' counts. */
export async function sourceKindCounts(opts: {
  userId: string;
  sessionId?: string | null;
}): Promise<Record<string, number> | null> {
  if (!configured()) return null;
  const response = await request(`/${INDEX}/_search`, {
    method: "POST",
    body: JSON.stringify({
      size: 0,
      query: { bool: { filter: sourceFilters(opts) } },
      aggs: {
        kinds: {
          terms: { field: "kind", size: 20 },
          aggs: { distinct: { cardinality: { field: "sourceId" } } },
        },
      },
    }),
  });
  const data = await response?.json();
  const buckets = (data?.aggregations?.kinds?.buckets || []) as any[];
  return Object.fromEntries(
    buckets.map((b) => [b.key, b.distinct?.value ?? b.doc_count])
  );
}

/**
 * Semantic + keyword search over the student's own material.
 *
 * Both halves earn their place: the vector half finds the passage that
 * means the same thing in different words, the BM25 half is what still
 * finds a source when the student types its filename or an exact term the
 * embedding blurs away. Highlighting comes from the keyword half, which is
 * why the snippet shows the words they actually typed.
 */
export async function searchSourcesElastic(opts: {
  userId: string;
  query: string;
  sessionId?: string | null;
  kind?: string | null;
  k?: number;
}): Promise<ElasticSourceRow[] | null> {
  if (!configured() || !opts.query.trim()) return null;

  const embedding = await embedForElastic(opts.query).catch(() => null);
  const filter = sourceFilters(opts);
  const k = opts.k ?? 30;

  const body: Record<string, unknown> = {
    size: k,
    query: {
      bool: {
        filter,
        should: [
          { match: { text: { query: opts.query, boost: 1 } } },
          { match: { title: { query: opts.query, boost: 3 } } },
        ],
        minimum_should_match: 1,
      },
    },
    collapse: { field: "sourceId", inner_hits: { name: "all", size: 0 } },
    highlight: { fields: { text: { fragment_size: 200, number_of_fragments: 1 } } },
    _source: { excludes: ["embedding"] },
  };

  if (embedding) {
    body.knn = {
      field: "embedding",
      query_vector: embedding,
      k,
      num_candidates: Math.max(100, k * 5),
      filter: { bool: { filter } },
    };
  }

  const response = await request(`/${INDEX}/_search`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await response?.json();
  return ((data?.hits?.hits || []) as any[]).map(rowFromHit);
}

/** Remove a source and every chunk of it. */
export async function deleteElasticSource(opts: {
  userId: string;
  sourceId: string;
}): Promise<number> {
  if (!configured()) return 0;
  const response = await request(
    `/${INDEX}/_delete_by_query?refresh=true`,
    {
      method: "POST",
      body: JSON.stringify({
        query: {
          bool: {
            filter: [
              { term: { userId: opts.userId } },
              { term: { sourceId: opts.sourceId } },
            ],
          },
        },
      }),
    }
  );
  const data = await response?.json();
  return data?.deleted ?? 0;
}

/** Mute or unmute a source without deleting it. */
export async function setElasticSourceActive(opts: {
  userId: string;
  sourceId: string;
  active: boolean;
}): Promise<number> {
  if (!configured()) return 0;
  const response = await request(`/${INDEX}/_update_by_query?refresh=true`, {
    method: "POST",
    body: JSON.stringify({
      query: {
        bool: {
          filter: [
            { term: { userId: opts.userId } },
            { term: { sourceId: opts.sourceId } },
          ],
        },
      },
      script: {
        source: "ctx._source.active = params.active",
        params: { active: opts.active },
      },
    }),
  });
  const data = await response?.json();
  return data?.updated ?? 0;
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