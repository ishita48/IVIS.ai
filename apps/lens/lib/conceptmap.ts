/**
 * Concept map — one tree per session, built incrementally from the whole
 * conversation (typed chat and voice, student and tutor), grounded in the
 * student's active notes where they cover a topic.
 * ─────────────────────────────────────────────────────────────────────
 * The model proposes; this file disposes. Every node and edge must carry
 * evidence, and every quote is checked to be literally inside the turn or
 * note passage it claims to come from. Anything that fails is dropped.
 * Every node is connected to the root; a link that is not backed by a
 * verbatim quote naming both ends says so in its `parentBasis`.
 */

import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";
import { elasticPrimary, indexElasticDocument, queryElasticDocs } from "./elastic";
import { llmJson } from "./llm";
import { recentEvents } from "./events";
import { getSession, DEFAULT_TITLE } from "./sessions";
import { hasTopicContent } from "./topic-turn";
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
  type LensEvent,
  type ParentBasis,
  type Relation,
} from "./lens/contracts";

const MONGO_COLLECTION = "concept_maps";
const ELASTIC_INDEX = "conceptMaps" as const;
const MIN_QUOTE_CHARS = 12;
const MAX_NODES = 40;
const MAX_EVIDENCE = 6;
const MAX_TURNS_PER_RUN = 8;
/** Fold-in attempts a turn gets before it is given up on. */
const MAX_ATTEMPTS = 3;
const TURN_QUERY_LIMIT = 1000;
const KEEP_PROCESSED = 2000;
/** One request drains the backlog, but never past this (the route has maxDuration 60s). */
const RUN_BUDGET_MS = 40_000;
/** Two concepts came up "in the same exchange" when their turns are this close. */
const CONVERSATION_WINDOW = 2;
/** A turn this short may not name a topic; the tutor's last message can. */
const VAGUE_WORDS = 6;

export type MapOutcome = "updated" | "nothing_new";

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
  const t = squash(text);
  // A whole short turn ("ATP") is a complete answer and may be quoted in full.
  if (!q || (q.length < MIN_QUOTE_CHARS && q.toLowerCase() !== t.toLowerCase())) return null;
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

/** The map plus how many turns are still waiting to be folded in. */
export async function getConceptState(
  sessionId: string,
  userId: string
): Promise<{ map: ConceptMap | null; pendingTurns: number }> {
  const raw = await load(sessionId);
  const events = await recentEvents(sessionId, userId, TURN_QUERY_LIMIT, "voice_turn");
  const pendingTurns = pendingOf(orderedTurns(events), raw ?? empty(sessionId)).length;
  return { map: raw ? strip(raw) : null, pendingTurns };
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

const SYSTEM = `You maintain a concept TREE of what a student is learning: one root (the main subject), and deeper levels that are more specific (e.g. photosynthesis > light reactions > where oxygen comes from). It is built from the WHOLE conversation, typed or spoken, from both the student and the tutor, and organised the way the student's notes organise the topic.

You get: the current tree, new conversation turns (student and tutor, oldest first; a student turn may show what the tutor had just said), and numbered passages from the student's notes (there may be none).

Rules:
- Names are SHORT: 1 to 4 words, lowercase ("light reactions", "quantifier"). Never a sentence. Shorten anything longer. Add at most 8 new concepts.
- Every topic that is discussed becomes a concept, whichever of the two raised it, and whether or not the notes cover it. Skip greetings, filler and small talk. A short answer such as "ATP" names a concept; the tutor's question just before it says what it answers.
- "root": if the tree has no root yet, name the main subject of the session as it appears in the notes/conversation, and include it in "nodes" too. Leave it out once a root exists.
- "status" is required. "shaky" if the STUDENT sounded unsure or said something a passage contradicts. "solid" only if the STUDENT stated it correctly and a passage agrees. Otherwise "mentioned". A concept only the tutor said is "mentioned".
- PARENT: give each node at most ONE "parent" (an existing concept or one in this batch) with "relation" exactly one of: ${PARENT_RELATIONS.join(", ")}. If one quote mentions BOTH the concept and its parent (or states the relation), give it as "parentEvidence". Without such a quote you may still give a parent when the notes treat both together, or when the two came up in the same exchange; the server checks which of those holds and drops the parent if none does. Follow how the notes organise the topic. Never give the root a parent. You may add a better parent to a concept whose link is only "conversation" or "notes".
- "crossLinks": non-hierarchical links between two concepts, label exactly one of: ${CROSS_RELATIONS.join(", ")}. Only when a quote states it. Never link concepts just because they appeared together.
- EVERY node, quote-backed parent link and cross-link needs evidence: {"turn": <n>, "quote": "<exact words from that turn>"} (a student OR tutor turn) and/or {"passage": <n>, "quote": "<exact words from that passage>"}. Copy quotes character for character, at least 12 characters (or the whole turn, if it is shorter). Anything without a quote you can copy is discarded. When a passage mentions the concept, also add a passage quote.
- "reviewQuestion": one question making the student recall the concept in their own words. It must NOT contain the answer.
- "answer" (optional): only if a passage answers the reviewQuestion: {"text": "<one or two sentences, restating ONLY what the quote says>", "passage": <n>, "quote": "<exact words from that passage>"}. If the notes don't answer it, omit "answer". Never use outside knowledge.
- If nothing qualifies, return empty lists.

Respond with JSON: {"root":"","nodes":[{"name","status","reviewQuestion","evidence":[...],"parent","relation","parentEvidence":[...],"answer":{...}}],"crossLinks":[{"from","to","label","evidence":[...]}]}`;

type Role = "user" | "agent";
type Turn = { eventId: string; role: Role; text: string; context: string | null; order: number };
type BatchTurn = Turn & { n: number };

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
  // Every link stored before `parentBasis` existed was quote-verified.
  for (const n of nodes.values()) {
    if (n.parentId && !n.parentBasis) n.parentBasis = "quote";
    if (n.inNotes === undefined) n.inNotes = n.evidence.some((e) => e.kind === "note");
  }
  return { ...map, nodes: [...nodes.values()], edges: keep };
}

// ── Turns ─────────────────────────────────────────────────────────────

/**
 * Every recorded turn of the conversation, both roles and both channels, in
 * event-timestamp order (ties keep the order given). `order` is the turn's
 * place in the whole conversation, so "same exchange" can be measured.
 */
export function orderedTurns(events: LensEvent[]): Turn[] {
  const sorted = events
    .map((e, i) => ({ e, i, at: Date.parse(e.timestamp) }))
    .filter(({ e }) => e.type === "voice_turn")
    .sort((a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) && a.at !== b.at ? a.at - b.at : a.i - b.i))
    .map(({ e }) => e);
  const turns: Turn[] = [];
  let lastTutor: string | null = null;
  for (const e of sorted) {
    const p = e.payload as any;
    if ((p?.role !== "user" && p?.role !== "agent") || typeof p.text !== "string" || !e._id) continue;
    const text = p.text.trim();
    if (!text) continue;
    const context =
      p.role === "user"
        ? lastTutor ?? (typeof p.tutorContext === "string" ? p.tutorContext : null)
        : null;
    turns.push({ eventId: e._id, role: p.role, text, context: context?.slice(0, 400) ?? null, order: turns.length });
    if (p.role === "agent") lastTutor = text;
  }
  return turns;
}

/** Turns still to fold in: not yet consumed, and with something in them that can be a topic. */
function pendingOf(all: Turn[], map: ConceptMap): Turn[] {
  const done = new Set(map.processedEventIds ?? []);
  return all.filter((t) => !done.has(t.eventId) && hasTopicContent(t.text));
}

// ── Build ─────────────────────────────────────────────────────────────

export async function updateConceptMap(input: {
  sessionId: string;
  userId: string;
}): Promise<{ outcome: MapOutcome; map: ConceptMap; pendingTurns: number }> {
  const { sessionId, userId } = input;
  const map = (await load(sessionId)) ?? empty(sessionId, userId);
  const events = await recentEvents(sessionId, userId, TURN_QUERY_LIMIT, "voice_turn");
  const all = orderedTurns(events);
  const orderOf = new Map(all.map((t) => [t.eventId, t.order]));
  const ctx: Ctx = { sessionId, userId, all, orderOf, passageTitle: null };

  const startedAt = Date.now();
  const tried = new Set<string>(); // a turn gets one attempt per request; retries come from the poll
  let changed = false;
  for (;;) {
    const pending = pendingOf(all, map).filter((t) => !tried.has(t.eventId));
    if (!pending.length || Date.now() - startedAt > RUN_BUDGET_MS) break;
    const batch = pending.slice(0, MAX_TURNS_PER_RUN).map((t, i) => ({ ...t, n: i + 1 }));
    batch.forEach((t) => tried.add(t.eventId));
    changed = (await foldBatch(map, batch, ctx)) || changed;
    await save(map);
  }

  // A map that predates this rule (or lost its root) is repaired even with nothing pending.
  if (map.nodes.length && (await connect(map, ctx, new Date().toISOString()))) {
    changed = true;
    await save(map);
  }
  return {
    outcome: changed ? "updated" : "nothing_new",
    map: strip({ ...map, updatedAt: changed ? new Date().toISOString() : map.updatedAt }),
    pendingTurns: pendingOf(all, map).length,
  };
}

type Ctx = {
  sessionId: string;
  userId: string;
  all: Turn[];
  orderOf: Map<string, number>;
  /** A note title seen while folding, for deriving a root. */
  passageTitle: { sourceId: string; title: string } | null;
};

/** Folds one batch into `map` (mutating it). Returns whether anything changed. */
async function foldBatch(map: ConceptMap, batch: BatchTurn[], ctx: Ctx): Promise<boolean> {
  const { sessionId, userId, orderOf } = ctx;

  // Notes are retrieved for every turn, but never gate it: a topic the notes
  // don't cover still becomes a node (inNotes: false). Passages only back
  // answers, statuses and "notes-structure" links.
  const allowed = await activeSessionSourceIds(userId, sessionId);
  const passages: Passage[] = [];
  if (allowed.length > 0) {
    for (const turn of batch) {
      const opts = { allowed, minScore: MIN_VECTOR_SCORE };
      let hits = await retrievePassages(userId, sessionId, turn.text.slice(0, 600), 3, opts);
      // A vague student turn has no topic of its own: judge it with what the tutor had just said.
      if (!hits.length && turn.role === "user" && turn.context && turn.text.split(/\s+/).length <= VAGUE_WORDS) {
        hits = await retrievePassages(userId, sessionId, `${turn.context} ${turn.text}`, 3, opts);
      }
      for (const h of hits) {
        if (!passages.some((p) => p.sourceId === h.sourceId && p.text === h.text)) passages.push(h);
      }
    }
    if (passages[0] && !ctx.passageTitle) ctx.passageTitle = { sourceId: passages[0].sourceId, title: passages[0].title };
  }

  const describe = (n: ConceptNode) =>
    `${n.name} [${n.status}]${
      n.parentId ? ` (${n.parentRelation} ${n.parentId}, via ${n.parentBasis ?? "quote"})` : n.id === map.rootId ? " (ROOT)" : ""
    }`;
  const prompt = [
    "== CURRENT TREE ==",
    map.rootId ? `root: ${map.rootId}` : "root: (none yet)",
    map.nodes.length ? map.nodes.map(describe).join("; ") : "(empty)",
    map.edges.length ? `cross-links: ${map.edges.map((e) => `${e.from} -${e.label}-> ${e.to}`).join("; ")}` : "",
    "\n== NEW CONVERSATION TURNS ==",
    ...batch.map(
      (t) =>
        `[T${t.n}]${t.role === "user" && t.context ? ` (tutor had just said: "${t.context}")` : ""} ${
          t.role === "user" ? "student" : "tutor"
        }: "${t.text.slice(0, 1200)}"`
    ),
    passages.length ? "\n== PASSAGES FROM THE STUDENT'S NOTES ==" : "",
    ...passages.map((p, i) => `[P${i + 1}] "${p.title}": ${p.text.slice(0, 800)}`),
  ].join("\n");

  const out = await llmJson<ModelOutput>(SYSTEM, prompt, { temperature: 0.2, maxTokens: 2500 });

  // ── Validate: quotes must be literal; nothing without evidence survives.
  const byTurn = new Map(batch.map((t) => [t.n, t]));
  type Checked = { ev: Evidence; ctx: string };
  const check = (raw: RawEvidence[] | undefined): Checked[] => {
    const res: Checked[] = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const turn = r.turn !== undefined ? byTurn.get(Number(r.turn)) : undefined;
      if (turn) {
        const quote = verbatim(r.quote, turn.text);
        // The tutor's message may stand in for the topic only on a vague student turn.
        const vague = turn.role === "user" && turn.text.split(/\s+/).length <= VAGUE_WORDS;
        if (quote)
          res.push({
            ev: { kind: turn.role === "user" ? "student" : "tutor", eventId: turn.eventId, quote },
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
  const folded = new Set<string>(); // turns a validated node or link rests on
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
    const hasConversation = hasStudent || ev.some((x) => x.ev.kind === "tutor");
    const hasNote = ev.some((x) => x.ev.kind === "note");
    // The root may come from the notes alone; every other node came up in conversation.
    const noteOnlyRoot = id === rootProposal && hasNote;
    if (!hasConversation && !noteOnlyRoot) {
      reject(`node "${id}"`, "not backed by a turn of the conversation");
      continue;
    }
    // The model forgot its note citation. If a passage really mentions the
    // concept, cite a sentence of it verbatim; if none does, the notes don't
    // cover it: the node stays, marked inNotes: false.
    let cited = false;
    if (!hasNote) {
      const cite = noteFor(id, passages);
      if (cite) {
        ev.push({ ev: cite, ctx: "" });
        cited = true;
      }
    }
    const inNotes = hasNote || cited;

    // Only the student's own words can make a concept shaky or solid.
    let status: ConceptStatus = "mentioned";
    if (hasStudent) {
      // "solid" needs a note the MODEL chose to compare against, not a fallback one.
      if (raw.status === "solid" && hasNote && !cited) status = "solid";
      else if (raw.status === "shaky") status = "shaky";
    }

    const existing = nodes.get(id);
    const evidence = mergeEvidence(existing?.evidence ?? [], ev.map((x) => x.ev));
    const question = typeof raw.reviewQuestion === "string" ? raw.reviewQuestion.trim() : "";
    const answer = inNotes ? checkAnswer(raw.answer, id) : null;
    if (existing) {
      // "mentioned" carries no information, so it never downgrades a status.
      const next: ConceptNode = {
        ...existing,
        evidence,
        status: status === "mentioned" ? existing.status : status,
        inNotes: existing.inNotes || inNotes,
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
        inNotes,
        evidence,
        reviewQuestion: question || null,
        ...(answer ? { answer } : {}),
        addedAt: now,
      });
      addedNodes.push(id);
      changed = true;
    } else continue;
    for (const x of ev) if (x.ev.kind !== "note") folded.add(x.ev.eventId);
  }

  // Root: proposed once, must be a node that survived validation above.
  if (rootProposal) {
    const r = nodes.get(rootProposal);
    if (r && !r.parentId) {
      map.rootId = rootProposal;
      changed = true;
    } else reject(`root "${rootProposal}"`, r ? "it already has a parent" : "not a valid, evidenced node");
  }

  // Parent links (second pass so a parent added in this batch exists). The
  // model only proposes; the basis is whichever check actually holds.
  for (const raw of out.nodes ?? []) {
    const id = conceptId(String(raw.name ?? ""));
    const pid = conceptId(String(raw.parent ?? ""));
    const child = nodes.get(id);
    if (!id || !pid || !child) continue;
    const what = `parent link "${id}" → "${pid}"`;
    const relation = PARENT_RELATIONS.find((r) => r === raw.relation);
    if (!relation) reject(what, `relation "${raw.relation}" is not one of ${PARENT_RELATIONS.join("/")}`);
    else if (id === pid) reject(what, "a node cannot be its own parent");
    else if (!nodes.has(pid)) reject(what, "the parent is not in the map");
    else if (id === map.rootId) reject(what, "the root has no parent");
    else if (child.parentId === pid) continue;
    else if (cyclic(nodes, id, pid)) reject(what, "it would create a cycle");
    else {
      const parent = nodes.get(pid)!;
      const found = parentBasis(child, parent, check(raw.parentEvidence), passages, orderOf, both);
      if (!found) reject(what, "no shared quote, note passage or exchange links the two");
      else if (child.parentId && !canReplace(child, found.basis, map.rootId)) continue; // keep the stronger link
      else {
        nodes.set(id, {
          ...child,
          parentId: pid,
          parentRelation: relation,
          parentBasis: found.basis,
          parentEvidence: mergeEvidence([], found.evidence),
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

  // A turn is consumed once something rests on it, or after a bounded number
  // of fruitless attempts. Until then it stays pending and is tried again.
  const attempts = { ...(map.attempts ?? {}) };
  const consumed: string[] = [];
  for (const t of batch) {
    if (folded.has(t.eventId)) {
      consumed.push(t.eventId);
      delete attempts[t.eventId];
    } else {
      attempts[t.eventId] = (attempts[t.eventId] ?? 0) + 1;
      if (attempts[t.eventId] >= MAX_ATTEMPTS) {
        console.warn(`[conceptmap] giving up on turn ${t.eventId} after ${MAX_ATTEMPTS} attempts`);
        consumed.push(t.eventId);
        delete attempts[t.eventId];
      }
    }
  }
  map.attempts = attempts;
  map.processedEventIds = [...(map.processedEventIds ?? []), ...consumed].slice(-KEEP_PROCESSED);

  map.nodes = [...nodes.values()];
  map.edges = [...edges.values()] as ConceptEdge[];
  const before = new Set(map.nodes.map((n) => n.id));
  if (await connect(map, ctx, now)) changed = true;
  for (const n of map.nodes) if (!before.has(n.id)) addedNodes.push(n.id); // a derived root
  if (addedNodes.length || addedEdges.length) map.lastAdded = { nodes: addedNodes, edges: addedEdges };
  return changed;
}

const RANK: Record<ParentBasis, number> = { quote: 3, "notes-structure": 2, conversation: 1 };

/** A stronger basis replaces a weaker one; a default-to-root link yields to any real parent. */
function canReplace(child: ConceptNode, basis: ParentBasis, rootId?: string): boolean {
  const old = child.parentBasis ?? "quote";
  const fallback = old === "conversation" && child.parentId === rootId;
  return RANK[basis] > RANK[old] || (fallback && RANK[basis] >= RANK.conversation);
}

/** Which check, strongest first, actually holds for child → parent? */
function parentBasis(
  child: ConceptNode,
  parent: ConceptNode,
  quoted: { ev: Evidence; ctx: string }[],
  passages: Passage[],
  orderOf: Map<string, number>,
  both: (c: { ev: Evidence; ctx: string }[], a: string, b: string) => boolean
): { basis: ParentBasis; evidence: Evidence[] } | null {
  // 1. A verbatim quote names both.
  if (both(quoted, child.id, parent.id)) return { basis: "quote", evidence: quoted.map((x) => x.ev) };

  // 2. The notes treat both together: same passage, title counted as its heading.
  for (const p of passages) {
    const text = `${p.title}. ${p.text}`;
    if (!mentions(text, child.id) || !mentions(text, parent.id)) continue;
    const cite = noteFor(child.id, [p]) ?? noteFor(parent.id, [p]);
    if (cite) return { basis: "notes-structure", evidence: [cite] };
  }

  // 3. They came up in the same exchange: turns within a small window.
  const said = (n: ConceptNode) =>
    n.evidence.flatMap((e) => {
      const at = e.kind === "note" ? undefined : orderOf.get(e.eventId);
      return at === undefined ? [] : [{ e, at }];
    });
  let best: { c: Evidence; p: Evidence; d: number } | null = null;
  for (const c of said(child))
    for (const p of said(parent)) {
      const d = Math.abs(c.at - p.at);
      if (d <= CONVERSATION_WINDOW && (!best || d < best.d)) best = { c: c.e, p: p.e, d };
    }
  if (best) return { basis: "conversation", evidence: [best.c, best.p] };
  return null;
}

// ── Connectivity ──────────────────────────────────────────────────────

/**
 * Makes the tree connected: picks a root if there is none, and hangs every
 * node that has no route to it directly under it, marked "conversation" (it
 * was discussed in this session, nothing more is claimed). Returns whether
 * anything changed.
 */
async function connect(map: ConceptMap, ctx: Ctx, now: string): Promise<boolean> {
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  if (!nodes.size) return false;
  let changed = false;

  const top = (id: string) => {
    let cur = id;
    for (let i = 0; i < 100; i++) {
      const p = nodes.get(cur)?.parentId;
      if (!p || !nodes.has(p)) break;
      cur = p;
    }
    return cur;
  };

  if (!map.rootId || !nodes.has(map.rootId)) {
    const first = ctx.all[0];
    const candidates: { title: string; ev: Evidence; inNotes: boolean }[] = [];
    if (ctx.passageTitle) {
      const { sourceId, title } = ctx.passageTitle;
      candidates.push({ title, ev: { kind: "note", sourceId, title, quote: title }, inNotes: true });
    }
    let sessionTitle: string | null = null;
    if (first) {
      try {
        const s = await getSession(ctx.userId, ctx.sessionId);
        sessionTitle = s && s.title !== DEFAULT_TITLE ? s.title : null;
      } catch {
        /* no session store here: fall through to the first topic */
      }
    }
    if (sessionTitle && first) {
      candidates.push({
        title: sessionTitle,
        ev: { kind: first.role === "user" ? "student" : "tutor", eventId: first.eventId, quote: squash(first.text).slice(0, 120) },
        inNotes: false,
      });
    }

    let rootId: string | null = null;
    for (const c of candidates) {
      const hit = [...nodes.keys()].find((id) => mentions(c.title, id));
      if (hit) rootId = top(hit);
      else {
        const id = conceptId(c.title.replace(/\.[a-z0-9]{2,4}$/i, "").split(/\s+/).slice(0, MAX_NAME_WORDS).join(" "));
        if (!id) continue;
        if (!nodes.has(id)) {
          nodes.set(id, { id, name: id, status: "mentioned", inNotes: c.inNotes, evidence: [c.ev], reviewQuestion: null, addedAt: now });
        }
        rootId = top(id);
      }
      break;
    }
    map.rootId = rootId ?? top([...nodes.keys()][0]); // the first topic raised
    changed = true;
  }

  const root = nodes.get(map.rootId)!;
  if (root.parentId) {
    nodes.set(root.id, { ...root, parentId: undefined, parentRelation: undefined, parentBasis: undefined, parentEvidence: undefined });
    changed = true;
  }

  const reaches = (id: string) => {
    let cur = id;
    for (let i = 0; i < 100; i++) {
      if (cur === map.rootId) return true;
      const p = nodes.get(cur)?.parentId;
      if (!p || !nodes.has(p)) return false;
      cur = p;
    }
    return false;
  };
  for (const n of [...nodes.values()]) {
    if (n.id === map.rootId || reaches(n.id)) continue;
    // Break a stale/looping chain, then attach: the only claim is "same session".
    const talk = n.evidence.filter((e) => e.kind !== "note").slice(0, 1);
    nodes.set(n.id, {
      ...n,
      parentId: map.rootId,
      parentRelation: "part of",
      parentBasis: "conversation",
      parentEvidence: talk,
    });
    changed = true;
  }
  if (changed) map.nodes = [...nodes.values()];
  return changed;
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
    const key = `${e.kind}|${e.kind === "note" ? e.sourceId : e.eventId}|${e.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.slice(0, MAX_EVIDENCE);
}

function strip(map: ConceptMap): ConceptMap {
  const visible = { ...map };
  delete visible.processedEventIds;
  delete visible.attempts;
  return visible;
}
