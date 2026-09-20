/**
 * Concept map — built incrementally from what the STUDENT said (voice turns
 * and typed chat), grounded in their active notes.
 * ─────────────────────────────────────────────────────────────────────
 * The model proposes; this file disposes. Every node and edge must carry
 * evidence, and every quote is checked to be literally inside the student
 * turn or note passage it claims to come from. Anything that fails is
 * dropped — there are no decorative links.
 */

import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import { elasticPrimary, indexElasticDocument, queryElasticDocs } from "./elastic";
import { llmJson } from "./llm";
import { recentEvents } from "./events";
import {
  MIN_VECTOR_SCORE,
  activeSessionSourceIds,
  retrievePassages,
  type Passage,
} from "./reasoning";
import {
  CROSS_RELATIONS,
  PARENT_RELATIONS,
  type NodeAnswer,
  type ConceptEdge,
  type ConceptMap,
  type ConceptNode,
  type ConceptStatus,
  type Evidence,
  type Relation,
} from "./lens/contracts";

const MONGO_COLLECTION = "concept_maps";
const ELASTIC_INDEX = "conceptMaps" as const;
const MIN_TURN_CHARS = 12;
const MIN_QUOTE_CHARS = 12;
const MAX_NODES = 40;
const MAX_EVIDENCE = 6;
const MAX_TURNS_PER_RUN = 8;
/** A turn this short may not name a topic; the tutor's last message can. */
const VAGUE_WORDS = 6;

export type MapOutcome = "updated" | "nothing_new" | "skipped";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// ── Names ─────────────────────────────────────────────────────────────

function singular(w: string): string {
  if (w.length <= 3 || /(ss|us|is)$/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(sses|shes|ches|xes|zes)$/.test(w)) return w.slice(0, -2);
  return w.endsWith("s") ? w.slice(0, -1) : w;
}

const words = (s: string) =>
  squash(s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " "))
    .split(" ")
    .filter(Boolean)
    .map(singular);

/** Lowercased, trimmed, singularised — the identity of a concept. */
export function conceptId(name: string): string {
  return words(name).join(" ");
}

/** Does `text` mention the concept (plural/case tolerant)? */
function mentions(text: string, id: string): boolean {
  return !!id && ` ${words(text).join(" ")} `.includes(` ${id} `);
}

/** `quote` if it is literally inside `text` (ignoring whitespace and case), as written in `text`. */
function verbatim(quote: unknown, text: string): string | null {
  const q = squash(String(quote ?? ""));
  if (q.length < MIN_QUOTE_CHARS) return null;
  const t = squash(text);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? null : t.slice(i, i + Math.min(q.length, 300));
}

// ── Storage ───────────────────────────────────────────────────────────

const empty = (sessionId: string, userId?: string): ConceptMap => ({
  sessionId,
  userId,
  updatedAt: new Date(0).toISOString(),
  processedEventIds: [],
  lastAdded: { nodes: [], edges: [] },
  nodes: [],
  edges: [],
});

/**
 * One concept map per session, so the Elastic doc id is just the sessionId —
 * a plain get-by-id, no query needed. Mongo is the fallback for sessions
 * that predate the Elastic session store, or when Elastic is unavailable.
 */
async function load(sessionId: string): Promise<ConceptMap | null> {
  if (elasticPrimary()) {
    try {
      const rows = await queryElasticDocs<any>(ELASTIC_INDEX, {
        filter: [{ term: { _id: sessionId } }],
        size: 1,
      });
      if (rows?.length) {
        const { _id, ...rest } = rows[0];
        return migrate({ ...rest, sessionId, updatedAt: new Date(rest.updatedAt).toISOString() } as ConceptMap);
      }
    } catch (error) {
      console.warn("[conceptmap] Elastic read failed, trying Mongo:", (error as Error).message);
    }
  }

  if (!ObjectId.isValid(sessionId)) return null;
  const db = await getDb();
  const row: any = await db.collection(MONGO_COLLECTION).findOne({ sessionId: new ObjectId(sessionId) });
  if (!row) return null;
  const { _id, createdAt: _c, ...rest } = row;
  return migrate({ ...rest, sessionId, updatedAt: new Date(row.updatedAt).toISOString() } as ConceptMap);
}

/** The map as the client sees it (no bookkeeping). */
export async function getConceptMap(sessionId: string): Promise<ConceptMap | null> {
  const map = await load(sessionId);
  if (!map) return null;
  const { processedEventIds: _p, ...visible } = map;
  return visible;
}

async function save(map: ConceptMap) {
  const { sessionId, ...rest } = map;

  if (elasticPrimary()) {
    try {
      // PUT by id is an upsert — no separate insert/update branch needed.
      await indexElasticDocument(ELASTIC_INDEX, sessionId, {
        ...rest,
        sessionId,
        updatedAt: new Date().toISOString(),
      });
      return;
    } catch (error) {
      console.warn("[conceptmap] Elastic write failed, falling back to Mongo:", (error as Error).message);
    }
  }

  if (!ObjectId.isValid(sessionId)) {
    throw new Error(`Cannot store concept map: session ${sessionId} has no Mongo fallback and Elastic is unavailable`);
  }
  const db = await getDb();
  await db.collection(MONGO_COLLECTION).updateOne(
    { sessionId: new ObjectId(sessionId) },
    { $set: { ...rest, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
}

// ── Model contract ────────────────────────────────────────────────────

type RawEvidence = { turn?: number; passage?: number; quote?: string };
type RawNode = {
  name?: string;
  status?: string;
  reviewQuestion?: string;
  evidence?: RawEvidence[];
  parent?: string;
  relation?: string;
  parentEvidence?: RawEvidence[];
  answer?: { text?: string; passage?: number; quote?: string };
};
type ModelOutput = {
  root?: string;
  nodes?: RawNode[];
  crossLinks?: { from?: string; to?: string; label?: string; evidence?: RawEvidence[] }[];
};

const MAX_NAME_WORDS = 4;
const MAX_ANSWER_CHARS = 280;

const SYSTEM = `You maintain a concept TREE of what a student is learning: one root (the main subject), and deeper levels that are more specific (e.g. photosynthesis > light reactions > where oxygen comes from). It is built from what the student said, organised the way their notes organise the topic.

You get: the current tree, new student turns (each may show what the tutor had just said, as context), and numbered passages from the student's own notes.

Rules:
- Names are SHORT: 1 to 4 words, lowercase ("light reactions", "quantifier"). Never a sentence. Shorten anything longer. Add at most 6 new concepts.
- A concept is something the student actually raised, or — when a turn is vague ("I don't get it") — what the tutor was just asking about. Only add concepts the passages cover, when passages are given.
- "root": if the tree has no root yet, name the main subject of the session as it appears in the notes/conversation, and include it in "nodes" too. Leave it out once a root exists.
- "status" is required. "shaky" if the student sounded unsure or said something a passage contradicts. "solid" only if the student stated it correctly and a passage agrees. Otherwise "mentioned".
- PARENT: give each node at most ONE "parent" (an existing concept or one in this batch) with "relation" exactly one of: ${PARENT_RELATIONS.join(", ")}, plus "parentEvidence": a quote that mentions BOTH the concept and its parent (or states the relation). Follow how the notes organise the topic. A node with no supported parent gets NO parent — never invent one. Do not give the root a parent. You may also add a parent to an existing unattached ("loose") concept.
- "crossLinks": non-hierarchical links between two concepts, label exactly one of: ${CROSS_RELATIONS.join(", ")}. Only when a quote states it. Never link concepts just because they appeared together.
- EVERY node, parent link and cross-link needs evidence: {"turn": <n>, "quote": "<exact words from that student turn>"} and/or {"passage": <n>, "quote": "<exact words from that passage>"}. Copy quotes character for character, at least 12 characters. Never quote the tutor. Anything without a quote you can copy is discarded. When passages are given, every node also needs a passage quote mentioning that concept.
- "reviewQuestion": one question making the student recall the concept in their own words. It must NOT contain the answer.
- "answer" (optional): only if a passage answers the reviewQuestion: {"text": "<one or two sentences, restating ONLY what the quote says>", "passage": <n>, "quote": "<exact words from that passage>"}. If the notes don't answer it, omit "answer". Never use outside knowledge.
- If nothing qualifies, return empty lists.

Respond with JSON: {"root":"","nodes":[{"name","status","reviewQuestion","evidence":[...],"parent","relation","parentEvidence":[...],"answer":{...}}],"crossLinks":[{"from","to","label","evidence":[...]}]}`;

type Turn = { n: number; eventId: string; text: string; context: string | null };

const reject = (what: string, reason: string): null => {
  console.warn(`[conceptmap] rejected ${what}: ${reason}`);
  return null;
};

/** Old maps (flat, edge-based) read as trees: "part of" edges with evidence become parent links. */
function migrate(map: ConceptMap): ConceptMap {
  const nodes = new Map(map.nodes.map((n) => [n.id, { ...n }]));
  const keep: ConceptEdge[] = [];
  const cycles = (child: string, parent: string) => {
    for (let cur: string | undefined = parent, i = 0; cur && i < 100; cur = nodes.get(cur)?.parentId, i++)
      if (cur === child) return true;
    return false;
  };
  for (const e of map.edges ?? []) {
    const child = nodes.get(e.from);
    if (
      (e.label as string) === "part of" &&
      child &&
      !child.parentId &&
      nodes.has(e.to) &&
      e.from !== e.to &&
      e.from !== map.rootId &&
      e.evidence?.length &&
      !cycles(e.from, e.to)
    ) {
      child.parentId = e.to;
      child.parentRelation = "part of";
      child.parentEvidence = e.evidence;
    } else keep.push(e);
  }
  return { ...map, nodes: [...nodes.values()], edges: keep };
}

// ── Build ─────────────────────────────────────────────────────────────

export async function updateConceptMap(input: {
  sessionId: string;
  userId: string;
}): Promise<{ outcome: MapOutcome; map: ConceptMap }> {
  const { sessionId, userId } = input;
  const map = (await load(sessionId)) ?? empty(sessionId, userId);
  const done = new Set(map.processedEventIds ?? []);
  const events = await recentEvents(sessionId, 200);

  // New STUDENT turns only. Tutor turns are context, never evidence.
  const found: Omit<Turn, "n">[] = [];
  events.forEach((e, idx) => {
    const p = e.payload as any;
    if (e.type !== "voice_turn" || p?.role !== "user" || typeof p.text !== "string") return;
    if (!e._id || done.has(e._id) || p.text.trim().length < MIN_TURN_CHARS) return;
    let context: string | null = null;
    if (p.source === "chat") {
      context = typeof p.tutorContext === "string" ? p.tutorContext : null;
    } else {
      for (let i = idx - 1; i >= 0; i--) {
        const q = events[i].payload as any;
        if (events[i].type === "voice_turn" && q?.role === "agent" && q.text) {
          context = String(q.text);
          break;
        }
      }
    }
    found.push({ eventId: e._id, text: p.text.trim(), context: context?.slice(0, 400) ?? null });
  });
  if (!found.length) return { outcome: "nothing_new", map: strip(map) };

  const batch: Turn[] = found.slice(0, MAX_TURNS_PER_RUN).map((t, i) => ({ ...t, n: i + 1 }));

  // Notes gate: with active sources, a turn must be close to something in them.
  const allowed = await activeSessionSourceIds(userId, sessionId);
  const gated = allowed.length > 0;
  const passages: Passage[] = [];
  const kept: Turn[] = [];
  if (!gated) {
    kept.push(...batch);
  } else {
    for (const turn of batch) {
      const opts = { allowed, minScore: MIN_VECTOR_SCORE };
      let hits = await retrievePassages(userId, sessionId, turn.text, 3, opts);
      // A vague turn has no topic of its own: judge it together with what
      // the tutor had just said, not alone.
      if (!hits.length && turn.context && turn.text.split(/\s+/).length <= VAGUE_WORDS) {
        hits = await retrievePassages(userId, sessionId, `${turn.context} ${turn.text}`, 3, opts);
      }
      if (!hits.length) continue;
      kept.push(turn);
      for (const h of hits) {
        if (!passages.some((p) => p.sourceId === h.sourceId && p.text === h.text)) passages.push(h);
      }
    }
  }

  const markDone = () => {
    map.processedEventIds = [...(map.processedEventIds ?? []), ...batch.map((t) => t.eventId)].slice(-400);
  };

  // Everything in the batch was off the notes: consume it, add nothing.
  if (!kept.length) {
    markDone();
    await save(map);
    return { outcome: "skipped", map: strip(map) };
  }

  const describe = (n: ConceptNode) =>
    `${n.name} [${n.status}]${n.parentId ? ` (${n.parentRelation} ${n.parentId})` : n.id === map.rootId ? " (ROOT)" : " (loose)"}`;
  const prompt = [
    "== CURRENT TREE ==",
    map.rootId ? `root: ${map.rootId}` : "root: (none yet)",
    map.nodes.length ? map.nodes.map(describe).join("; ") : "(empty)",
    map.edges.length ? `cross-links: ${map.edges.map((e) => `${e.from} -${e.label}-> ${e.to}`).join("; ")}` : "",
    "\n== NEW STUDENT TURNS ==",
    ...kept.map(
      (t) => `[T${t.n}]${t.context ? ` (tutor had just said: "${t.context}")` : ""} student: "${t.text}"`
    ),
    passages.length ? "\n== PASSAGES FROM THE STUDENT'S NOTES ==" : "",
    ...passages.map((p, i) => `[P${i + 1}] "${p.title}": ${p.text.slice(0, 800)}`),
  ].join("\n");

  const out = await llmJson<ModelOutput>(SYSTEM, prompt, { temperature: 0.2, maxTokens: 2500 });

  // ── Validate: quotes must be literal; nothing without evidence survives.
  const byTurn = new Map(kept.map((t) => [t.n, t]));
  type Checked = { ev: Evidence; ctx: string };
  const check = (raw: RawEvidence[] | undefined): Checked[] => {
    const res: Checked[] = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const turn = r.turn !== undefined ? byTurn.get(Number(r.turn)) : undefined;
      if (turn) {
        const quote = verbatim(r.quote, turn.text);
        // The tutor's message may stand in for the topic only on a vague turn.
        const vague = turn.text.split(/\s+/).length <= VAGUE_WORDS;
        if (quote)
          res.push({
            ev: { kind: "student", eventId: turn.eventId, quote },
            ctx: vague ? turn.context ?? "" : "",
          });
        continue;
      }
      const p = r.passage !== undefined ? passages[Number(r.passage) - 1] : undefined;
      const quote = p && verbatim(r.quote, p.text);
      if (p && quote) res.push({ ev: { kind: "note", sourceId: p.sourceId, title: p.title, quote }, ctx: "" });
    }
    return res;
  };
  const named = (c: Checked[], id: string) =>
    c.some((x) => mentions(x.ev.quote, id) || mentions(x.ctx, id));
  const both = (c: Checked[], a: string, b: string) =>
    c.some((x) => (mentions(x.ev.quote, a) || mentions(x.ctx, a)) && (mentions(x.ev.quote, b) || mentions(x.ctx, b)));

  /** A note-backed answer: the quote must be verbatim in a passage that mentions the concept. */
  const checkAnswer = (raw: RawNode["answer"], id: string): NodeAnswer | null => {
    if (!raw) return null;
    const p = raw.passage !== undefined ? passages[Number(raw.passage) - 1] : undefined;
    const quote = p && verbatim(raw.quote, p.text);
    const text = squash(String(raw.text ?? ""));
    if (!p || !quote) return reject(`answer for "${id}"`, "quote is not verbatim in a retrieved passage");
    if (!mentions(p.text, id)) return reject(`answer for "${id}"`, "passage does not mention the concept");
    if (!text || text.length > MAX_ANSWER_CHARS || text.split(/(?<=[.!?])\s+/).length > 2)
      return reject(`answer for "${id}"`, "answer is empty or longer than two sentences");
    return { text, quote, sourceId: p.sourceId, title: p.title };
  };

  const now = new Date().toISOString();
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const edges = new Map(map.edges.map((e) => [e.id, e]));
  const addedNodes: string[] = [];
  const addedEdges: string[] = [];
  let changed = false;
  const rootProposal = map.rootId ? "" : conceptId(String(out.root ?? ""));

  for (const raw of out.nodes ?? []) {
    const id = conceptId(String(raw.name ?? ""));
    const ev = check(raw.evidence);
    if (!id) continue;
    if (id.length > 60 || words(id).length > MAX_NAME_WORDS) {
      reject(`node "${id}"`, `name longer than ${MAX_NAME_WORDS} words`);
      continue;
    }
    if (!named(ev, id)) {
      reject(`node "${id}"`, "no verbatim quote naming it");
      continue;
    }
    const hasStudent = ev.some((x) => x.ev.kind === "student");
    const hasNote = ev.some((x) => x.ev.kind === "note");
    // The root may come from the notes alone; every other node came up in conversation.
    const noteOnlyRoot = id === rootProposal && hasNote;
    let cited = false;
    if (!hasStudent && !noteOnlyRoot) {
      reject(`node "${id}"`, "not backed by a student turn");
      continue;
    }
    if (gated && !hasNote) {
      // The model forgot its note citation. If a passage really mentions the
      // concept, cite a sentence of it verbatim; if none does, the notes
      // don't cover it and the concept is dropped.
      const cite = noteFor(id, passages);
      if (!cite) {
        reject(`node "${id}"`, "notes don't cover it");
        continue;
      }
      ev.push({ ev: cite, ctx: "" });
      cited = true;
    }

    let status: ConceptStatus = "mentioned";
    // "solid" needs a note the MODEL chose to compare against, not a fallback one.
    if (raw.status === "solid" && hasNote && !cited) status = "solid";
    else if (raw.status === "shaky") status = "shaky";

    const existing = nodes.get(id);
    const evidence = mergeEvidence(existing?.evidence ?? [], ev.map((x) => x.ev));
    const question = typeof raw.reviewQuestion === "string" ? raw.reviewQuestion.trim() : "";
    const answer = checkAnswer(raw.answer, id);
    if (existing) {
      // "mentioned" carries no information, so it never downgrades a status.
      const next: ConceptNode = {
        ...existing,
        evidence,
        status: status === "mentioned" ? existing.status : status,
        reviewQuestion: question || existing.reviewQuestion,
        answer: answer ?? existing.answer,
      };
      if (JSON.stringify(next) !== JSON.stringify(existing)) changed = true;
      nodes.set(id, next);
    } else if (nodes.size < MAX_NODES) {
      nodes.set(id, {
        id,
        name: id,
        status,
        evidence,
        reviewQuestion: question || null,
        ...(answer ? { answer } : {}),
        addedAt: now,
      });
      addedNodes.push(id);
      changed = true;
    }
  }

  // Root: proposed once, must be a node that survived validation above.
  if (rootProposal) {
    const r = nodes.get(rootProposal);
    if (r && !r.parentId) {
      map.rootId = rootProposal;
      changed = true;
    } else reject(`root "${rootProposal}"`, r ? "it already has a parent" : "not a valid, evidenced node");
  }

  // Parent links (second pass so a parent added in this batch exists).
  for (const raw of out.nodes ?? []) {
    const id = conceptId(String(raw.name ?? ""));
    const pid = conceptId(String(raw.parent ?? ""));
    const child = nodes.get(id);
    if (!id || !pid || !child || child.parentId) continue; // an existing parent is kept
    const what = `parent link "${id}" → "${pid}"`;
    const relation = PARENT_RELATIONS.find((r) => r === raw.relation);
    if (!relation) reject(what, `relation "${raw.relation}" is not one of ${PARENT_RELATIONS.join("/")}`);
    else if (id === pid) reject(what, "a node cannot be its own parent");
    else if (!nodes.has(pid)) reject(what, "the parent is not in the map");
    else if (id === map.rootId) reject(what, "the root has no parent");
    else if (cyclic(nodes, id, pid)) reject(what, "it would create a cycle");
    else {
      const pe = check(raw.parentEvidence);
      if (!both(pe, id, pid)) reject(what, "no verbatim quote mentions both concepts");
      else {
        nodes.set(id, {
          ...child,
          parentId: pid,
          parentRelation: relation,
          parentEvidence: mergeEvidence([], pe.map((x) => x.ev)),
        });
        if (!addedNodes.includes(id)) addedNodes.push(id);
        changed = true;
      }
    }
  }

  for (const raw of out.crossLinks ?? []) {
    const a = conceptId(String(raw.from ?? ""));
    const b = conceptId(String(raw.to ?? ""));
    const label = CROSS_RELATIONS.find((r) => r === raw.label) as Relation | undefined;
    const what = `cross-link "${a}" -${raw.label}-> "${b}"`;
    if (!a || !b || a === b) continue;
    if (!label) reject(what, "unknown relation");
    else if (!nodes.has(a) || !nodes.has(b)) reject(what, "an endpoint is not in the map");
    else {
      const ev = check(raw.evidence);
      // At least one quote must actually mention BOTH concepts.
      if (!both(ev, a, b)) {
        reject(what, "no verbatim quote mentions both concepts");
        continue;
      }
      const [from, to] = label === "different from" && a > b ? [b, a] : [a, b];
      const id = `${from}|${label}|${to}`;
      const existing = edges.get(id);
      const evidence = mergeEvidence(existing?.evidence ?? [], ev.map((x) => x.ev));
      if (existing) {
        if (evidence.length !== existing.evidence.length) changed = true;
        edges.set(id, { ...existing, evidence });
      } else {
        edges.set(id, { id, from, to, label, evidence, addedAt: now });
        addedEdges.push(id);
        changed = true;
      }
    }
  }

  markDone();
  map.nodes = [...nodes.values()];
  map.edges = [...edges.values()] as ConceptEdge[];
  if (addedNodes.length || addedEdges.length) map.lastAdded = { nodes: addedNodes, edges: addedEdges };
  await save(map);
  return { outcome: changed ? "updated" : "nothing_new", map: strip({ ...map, updatedAt: now }) };
}

/** Would making `parent` the parent of `child` loop back to `child`? */
function cyclic(nodes: Map<string, ConceptNode>, child: string, parent: string): boolean {
  for (let cur: string | undefined = parent, i = 0; cur && i < 100; cur = nodes.get(cur)?.parentId, i++)
    if (cur === child) return true;
  return false;
}

/** A sentence from the first passage that mentions the concept, verbatim. */
function noteFor(id: string, passages: Passage[]): Evidence | null {
  for (const p of passages) {
    if (!mentions(p.text, id)) continue;
    const sentence = squash(p.text)
      .split(/(?<=[.!?:])\s+/)
      .find((s) => s.length >= MIN_QUOTE_CHARS && mentions(s, id));
    if (sentence) return { kind: "note", sourceId: p.sourceId, title: p.title, quote: sentence.slice(0, 240) };
  }
  return null;
}

function mergeEvidence(a: Evidence[], b: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of [...a, ...b]) {
    const key = `${e.kind}|${e.kind === "student" ? e.eventId : e.sourceId}|${e.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.slice(0, MAX_EVIDENCE);
}

function strip(map: ConceptMap): ConceptMap {
  const { processedEventIds: _p, ...visible } = map;
  return visible;
}
