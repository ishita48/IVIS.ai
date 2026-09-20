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
import { llmJson } from "./llm";
import { recentEvents } from "./events";
import {
  MIN_VECTOR_SCORE,
  activeSessionSourceIds,
  retrievePassages,
  type Passage,
} from "./reasoning";
import {
  RELATIONS,
  type ConceptEdge,
  type ConceptMap,
  type ConceptNode,
  type ConceptStatus,
  type Evidence,
  type Relation,
} from "./lens/contracts";

const COLLECTION = "concept_maps";
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

async function load(sessionId: string): Promise<ConceptMap | null> {
  if (!ObjectId.isValid(sessionId)) return null;
  const db = await getDb();
  const row: any = await db.collection(COLLECTION).findOne({ sessionId: new ObjectId(sessionId) });
  if (!row) return null;
  const { _id, createdAt: _c, ...rest } = row;
  return { ...rest, sessionId, updatedAt: new Date(row.updatedAt).toISOString() } as ConceptMap;
}

/** The map as the client sees it (no bookkeeping). */
export async function getConceptMap(sessionId: string): Promise<ConceptMap | null> {
  const map = await load(sessionId);
  if (!map) return null;
  const { processedEventIds: _p, ...visible } = map;
  return visible;
}

async function save(map: ConceptMap) {
  const db = await getDb();
  const { sessionId, ...rest } = map;
  await db.collection(COLLECTION).updateOne(
    { sessionId: new ObjectId(sessionId) },
    { $set: { ...rest, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
}

// ── Model contract ────────────────────────────────────────────────────

type RawEvidence = { turn?: number; passage?: number; quote?: string };
type ModelOutput = {
  nodes?: { name?: string; status?: string; reviewQuestion?: string; evidence?: RawEvidence[] }[];
  edges?: { from?: string; to?: string; label?: string; evidence?: RawEvidence[] }[];
};

const SYSTEM = `You maintain a concept map of what a student is learning, built ONLY from what the student said.

You get: the current map, new student turns (each may show what the tutor had just said, as context), and numbered passages from the student's own notes.

Rules:
- A concept is a noun phrase the student actually raised, or — when a student turn is vague ("I don't get it") — the concept the tutor was just asking about. Use short lowercase names ("quantifier", "predicate"). Add at most 6 new concepts.
- Only add concepts the notes passages cover, when passages are given.
- "status" is required on every node. "shaky" if the student sounded unsure ("I'm not sure what…", "I don't get…") or said something a passage contradicts. "solid" only if the student stated it correctly and a passage agrees. Otherwise "mentioned".
- An edge relates two concepts with exactly one label from: ${RELATIONS.join(", ")}. Add an edge only when the student's words or a passage state the relationship. Never add a link just because two concepts appeared together.
- EVERY node and edge needs "evidence": a list of {"turn": <turn number>, "quote": "<exact words from that student turn>"} and/or {"passage": <passage number>, "quote": "<exact words from that passage>"}. When passages are given, every node also needs a quote from a passage that mentions that concept. Copy quotes character for character, at least 12 characters. Never quote the tutor. Anything without a quote you can copy will be discarded.
- "reviewQuestion": one question that makes the student recall or restate the concept in their own words. It must NOT contain the definition or the answer.
- If nothing qualifies, return empty lists.

Respond with JSON: {"nodes":[{"name","status","reviewQuestion","evidence":[...]}],"edges":[{"from","to","label","evidence":[...]}]}`;

type Turn = { n: number; eventId: string; text: string; context: string | null };

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

  const prompt = [
    "== CURRENT MAP ==",
    map.nodes.length ? map.nodes.map((n) => `${n.name} [${n.status}]`).join("; ") : "(empty)",
    map.edges.length ? map.edges.map((e) => `${e.from} -${e.label}-> ${e.to}`).join("; ") : "",
    "\n== NEW STUDENT TURNS ==",
    ...kept.map(
      (t) => `[T${t.n}]${t.context ? ` (tutor had just said: "${t.context}")` : ""} student: "${t.text}"`
    ),
    passages.length ? "\n== PASSAGES FROM THE STUDENT'S NOTES ==" : "",
    ...passages.map((p, i) => `[P${i + 1}] "${p.title}": ${p.text.slice(0, 800)}`),
  ].join("\n");

  const out = await llmJson<ModelOutput>(SYSTEM, prompt, { temperature: 0.2, maxTokens: 2000 });

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

  const now = new Date().toISOString();
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const edges = new Map(map.edges.map((e) => [e.id, e]));
  const addedNodes: string[] = [];
  const addedEdges: string[] = [];
  let changed = false;

  for (const raw of out.nodes ?? []) {
    const id = conceptId(String(raw.name ?? ""));
    const ev = check(raw.evidence);
    if (!id || id.length > 60 || !named(ev, id)) continue;
    const hasStudent = ev.some((x) => x.ev.kind === "student");
    const hasNote = ev.some((x) => x.ev.kind === "note");
    let cited = false;
    if (!hasStudent) continue; // it must have come up in the conversation
    if (gated && !hasNote) {
      // The model forgot its note citation. If a passage really mentions the
      // concept, cite a sentence of it verbatim; if none does, the notes
      // don't cover it and the concept is dropped.
      const cite = noteFor(id, passages);
      if (!cite) continue;
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
    if (existing) {
      // "mentioned" carries no information, so it never downgrades a status.
      const next: ConceptNode = {
        ...existing,
        evidence,
        status: status === "mentioned" ? existing.status : status,
        reviewQuestion: question || existing.reviewQuestion,
      };
      if (JSON.stringify(next) !== JSON.stringify(existing)) changed = true;
      nodes.set(id, next);
    } else if (nodes.size < MAX_NODES) {
      nodes.set(id, { id, name: id, status, evidence, reviewQuestion: question || null, addedAt: now });
      addedNodes.push(id);
      changed = true;
    }
  }

  for (const raw of out.edges ?? []) {
    const a = conceptId(String(raw.from ?? ""));
    const b = conceptId(String(raw.to ?? ""));
    const label = RELATIONS.find((r) => r === raw.label) as Relation | undefined;
    if (!a || !b || a === b || !label || !nodes.has(a) || !nodes.has(b)) continue;
    const ev = check(raw.evidence);
    // At least one quote must actually mention BOTH concepts.
    if (!ev.some((x) => (mentions(x.ev.quote, a) || mentions(x.ctx, a)) && (mentions(x.ev.quote, b) || mentions(x.ctx, b))))
      continue;
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

  markDone();
  map.nodes = [...nodes.values()];
  map.edges = [...edges.values()] as ConceptEdge[];
  if (addedNodes.length || addedEdges.length) map.lastAdded = { nodes: addedNodes, edges: addedEdges };
  await save(map);
  return { outcome: changed ? "updated" : "nothing_new", map: strip({ ...map, updatedAt: now }) };
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
