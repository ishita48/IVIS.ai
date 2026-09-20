/* eslint-disable @typescript-eslint/no-explicit-any -- mocks and fixtures are loosely typed on purpose */
/**
 * The concept tree is built from recorded conversation events only. Storage,
 * the model, retrieval and the event log are mocked; no network.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ doc: null as any }));
const recentEvents = vi.hoisted(() => vi.fn());
const llmJson = vi.hoisted(() => vi.fn());
const retrievePassages = vi.hoisted(() => vi.fn());
const activeSessionSourceIds = vi.hoisted(() => vi.fn());

vi.mock("./mongodb", () => ({
  getDb: async () => ({
    collection: () => ({
      findOne: async () => (db.doc ? JSON.parse(JSON.stringify(db.doc)) : null),
      updateOne: async (_f: unknown, u: any) => {
        db.doc = JSON.parse(JSON.stringify({ ...db.doc, ...u.$set }));
      },
    }),
  }),
}));
vi.mock("./elastic", () => ({
  elasticPrimary: () => false,
  indexElasticDocument: vi.fn(),
  queryElasticDocs: vi.fn(),
}));
vi.mock("./sessions", () => ({ DEFAULT_TITLE: "New session", getSession: async () => null }));
vi.mock("./events", () => ({ recentEvents }));
vi.mock("./llm", () => ({ llmJson }));
vi.mock("./reasoning", () => ({ MIN_VECTOR_SCORE: 0.67, activeSessionSourceIds, retrievePassages }));

import { conceptId, updateConceptMap } from "./conceptmap";
import type { ConceptMap, ConceptNode } from "./lens/contracts";

const SID = "507f1f77bcf86cd799439011";
const T0 = Date.parse("2026-01-01T10:00:00Z");
let seq = 0;

type Src = "chat" | "voice";
const turn = (role: "user" | "agent", source: Src, text: string, at = ++seq) => ({
  _id: `e${at}`,
  sessionId: SID,
  userId: "u",
  type: "voice_turn",
  concept: null,
  payload: { role, text, at, source },
  timestamp: new Date(T0 + at * 1000).toISOString(),
});

// ── A fake model: a lookup table, so the test controls exactly what it "says" ─

const NOTE = {
  sourceId: "s1",
  title: "Photosynthesis",
  text: "Photosynthesis has two stages. The light reactions occur in the thylakoid membranes. The Calvin cycle uses ATP to fix carbon dioxide.",
};
type Topic = { when: RegExp; name: string; parent?: string; status?: string; note?: string; root?: boolean };
const TOPICS: Topic[] = [
  { when: /photosynthesis/i, name: "photosynthesis", root: true, status: "solid", note: "Photosynthesis has two stages." },
  { when: /light reactions/i, name: "light reactions", parent: "photosynthesis", note: "The light reactions occur in the thylakoid membranes." },
  { when: /thylakoid/i, name: "thylakoid", parent: "light reactions", note: "The light reactions occur in the thylakoid membranes." },
  { when: /calvin cycle/i, name: "calvin cycle", parent: "photosynthesis", status: "solid", note: "The Calvin cycle uses ATP to fix carbon dioxide." },
  { when: /^ATP$/, name: "atp", parent: "calvin cycle", note: "The Calvin cycle uses ATP to fix carbon dioxide." },
  { when: /chlorophyll/i, name: "chlorophyll", parent: "photosynthesis" },
  { when: /stomata/i, name: "stomata" },
  { when: /electron transport chain/i, name: "electron transport chain", parent: "light reactions", status: "shaky" },
];

/** Reads the prompt the builder sends, answers from TOPICS. Quotes are whole turns, so they are verbatim. */
function fakeModel(topics: Topic[] = TOPICS) {
  return async (_sys: string, prompt: string) => {
    const out: any = { root: "", nodes: [], crossLinks: [] };
    const hasPassages = prompt.includes("[P1]");
    for (const line of prompt.split("\n")) {
      const m = line.match(/^\[T(\d+)\].*? (student|tutor): "(.*)"$/);
      if (!m) continue;
      const [, n, , text] = m;
      for (const t of topics) {
        if (!t.when.test(text)) continue;
        if (t.root && prompt.includes("root: (none yet)")) out.root = t.name;
        const evidence: any[] = [{ turn: Number(n), quote: text }];
        if (hasPassages && t.note) evidence.push({ passage: 1, quote: t.note });
        out.nodes.push({
          name: t.name,
          status: t.status ?? "mentioned",
          evidence,
          reviewQuestion: `Explain ${t.name} in your own words?`,
          ...(t.parent
            ? {
                parent: t.parent,
                relation: "part of",
                // A quote is offered only when the turn itself names the parent.
                parentEvidence: text.toLowerCase().includes(t.parent) ? [{ turn: Number(n), quote: text }] : [],
              }
            : {}),
        });
      }
    }
    return out;
  };
}

beforeEach(() => {
  seq = 0;
  db.doc = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  recentEvents.mockReset();
  llmJson.mockReset().mockImplementation(fakeModel());
  activeSessionSourceIds.mockReset().mockResolvedValue([]);
  retrievePassages.mockReset().mockImplementation(async (_u: string, _s: string, q: string) =>
    /stomata/i.test(q) ? [] : /photosynth|light reactions|thylakoid|calvin|atp|chlorophyll|electron/i.test(q) ? [NOTE] : []
  );
});

const run = () => updateConceptMap({ sessionId: SID, userId: "u" });
const nodeOf = (name: string) => (db.doc.nodes as ConceptNode[]).find((n) => n.id === conceptId(name))!;
const ids = (...names: string[]) => names.map(conceptId).sort();
const promptTurns = () => llmJson.mock.calls.flatMap((c) => String(c[1]).split("\n").filter((l) => l.startsWith("[T")));

/** One root, no loose nodes, every chain reaches the root, no cycles. */
function expectOneConnectedTree(map: ConceptMap) {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  expect(byId.size, "duplicate node ids").toBe(map.nodes.length);
  expect(map.rootId, "no root").toBeTruthy();
  const root = byId.get(map.rootId!)!;
  expect(root).toBeTruthy();
  expect(root.parentId, "the root has a parent").toBeUndefined();
  for (const n of map.nodes) {
    if (n.id === map.rootId) continue;
    let cur: ConceptNode | undefined = n;
    let hops = 0;
    while (cur && cur.id !== map.rootId && hops++ <= map.nodes.length) cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    expect(cur?.id, `"${n.id}" has no parent chain to the root`).toBe(map.rootId);
    expect(n.parentBasis, `"${n.id}" has no basis`).toBeTruthy();
  }
}

const typed = () => [
  turn("agent", "chat", "Let's talk about photosynthesis. What do you know about it?"),
  turn("user", "chat", "Photosynthesis turns light energy into sugar"),
  turn("user", "chat", "the light reactions happen in the thylakoid membranes"),
  turn("agent", "chat", "And what about the Calvin cycle?"),
  turn("user", "chat", "ATP"),
  turn("user", "chat", "Chlorophyll absorbs red and blue light"),
];
const spoken = () => typed().map((e) => ({ ...e, payload: { ...e.payload, source: "voice" } }));

describe("one tree from the whole conversation", () => {
  it("typed only", async () => {
    recentEvents.mockResolvedValue(typed());
    await run();
    expectOneConnectedTree(db.doc);
    expect(db.doc.nodes.map((n: ConceptNode) => n.id).sort()).toEqual(
      ids("atp", "calvin cycle", "chlorophyll", "light reactions", "photosynthesis", "thylakoid")
    );
  });

  it("voice only", async () => {
    recentEvents.mockResolvedValue(spoken());
    await run();
    expectOneConnectedTree(db.doc);
    expect(db.doc.nodes).toHaveLength(6);
  });

  it("mixed typed and spoken, tutor and student, with off-notes topics", async () => {
    activeSessionSourceIds.mockResolvedValue(["s1"]);
    recentEvents.mockResolvedValue([
      ...typed().slice(0, 3),
      turn("agent", "voice", "And what about the Calvin cycle?"),
      turn("user", "voice", "ATP"),
      turn("user", "chat", "Chlorophyll absorbs red and blue light"),
      turn("user", "voice", "stomata let carbon dioxide in"),
      turn("user", "chat", "ok thanks"),
      turn("agent", "chat", "Nice. The electron transport chain pumps protons across the membrane."),
    ]);
    const r = await run();
    expectOneConnectedTree(db.doc);
    expect(r.pendingTurns).toBe(0);
    expect(db.doc.rootId).toBe("photosynthesis");
    expect(db.doc.nodes.map((n: ConceptNode) => n.id).sort()).toEqual(
      ids("atp", "calvin cycle", "chlorophyll", "electron transport chain", "light reactions", "photosynthesis", "stomata", "thylakoid")
    );
    // Off the notes: still a node, marked as such.
    expect(nodeOf("stomata").inNotes).toBe(false);
    expect(nodeOf("chlorophyll").inNotes).toBe(false);
    expect(nodeOf("thylakoid").inNotes).toBe(true);
    // Filler never reaches the model.
    expect(promptTurns().some((l) => l.includes("ok thanks"))).toBe(false);
    // The returned map hides bookkeeping.
    expect(r.map).not.toHaveProperty("processedEventIds");
  });

  it("short answers such as ATP become nodes", async () => {
    recentEvents.mockResolvedValue(typed());
    await run();
    expect(promptTurns().some((l) => l.includes('student: "ATP"'))).toBe(true);
    expect(nodeOf("atp").evidence.some((e) => e.kind === "student" && e.quote === "ATP")).toBe(true);
  });
});

describe("parent links and their basis", () => {
  it("labels each link by what actually holds, strongest first", async () => {
    activeSessionSourceIds.mockResolvedValue(["s1"]);
    recentEvents.mockResolvedValue(typed());
    await run();
    // One quote names both.
    expect(nodeOf("thylakoid")).toMatchObject({ parentId: conceptId("light reactions"), parentBasis: "quote" });
    // Same note passage, no shared quote.
    expect(nodeOf("light reactions")).toMatchObject({ parentId: "photosynthesis", parentBasis: "notes-structure" });
    expect(nodeOf("calvin cycle")).toMatchObject({ parentId: "photosynthesis", parentBasis: "notes-structure" });
    // Far from its proposed parent and outside the notes: attached to the root, as conversation only.
    expect(nodeOf("chlorophyll")).toMatchObject({ parentId: "photosynthesis", parentBasis: "conversation" });
  });

  it("accepts a parent introduced in the same exchange (turn window)", async () => {
    llmJson.mockImplementation(
      fakeModel([
        { when: /stomata/i, name: "stomata", root: true },
        { when: /guard cells/i, name: "guard cells", parent: "stomata" },
      ])
    );
    recentEvents.mockResolvedValue([
      turn("user", "voice", "stomata let carbon dioxide in"),
      turn("user", "voice", "guard cells open and close them"),
    ]);
    await run();
    expect(nodeOf("guard cells")).toMatchObject({ parentId: conceptId("stomata"), parentBasis: "conversation" });
    expectOneConnectedTree(db.doc);
  });

  it("keeps the anti-cycle check", async () => {
    llmJson.mockResolvedValue({
      root: "alpha",
      nodes: [
        { name: "alpha", status: "mentioned", evidence: [{ turn: 1, quote: "alpha is the first topic" }] },
        { name: "beta", status: "mentioned", evidence: [{ turn: 2, quote: "beta comes after alpha" }], parent: "alpha", relation: "part of", parentEvidence: [{ turn: 2, quote: "beta comes after alpha" }] },
        // alpha under beta would close a loop (and alpha is the root).
        { name: "alpha", status: "mentioned", evidence: [{ turn: 1, quote: "alpha is the first topic" }], parent: "beta", relation: "part of", parentEvidence: [{ turn: 2, quote: "beta comes after alpha" }] },
      ],
    });
    recentEvents.mockResolvedValue([turn("user", "chat", "alpha is the first topic"), turn("user", "chat", "beta comes after alpha")]);
    await run();
    expect(nodeOf("alpha").parentId).toBeUndefined();
    expectOneConnectedTree(db.doc);
  });

  it("picks a root even when the model proposes none", async () => {
    llmJson.mockImplementation(fakeModel([{ when: /mitosis/i, name: "mitosis" }, { when: /spindle/i, name: "spindle" }]));
    recentEvents.mockResolvedValue([turn("user", "chat", "mitosis splits one cell in two"), turn("user", "chat", "the spindle pulls chromosomes apart")]);
    await run();
    expect(db.doc.rootId).toBe("mitosis"); // the first topic raised
    expectOneConnectedTree(db.doc);
  });
});

describe("evidence", () => {
  it("rejects a hallucinated quote and does not consume the turn", async () => {
    llmJson.mockResolvedValue({
      nodes: [{ name: "thylakoid", status: "mentioned", evidence: [{ turn: 1, quote: "this sentence was never said aloud" }] }],
    });
    recentEvents.mockResolvedValue([turn("user", "chat", "light reactions happen in the thylakoid")]);
    const r = await run();
    expect(db.doc.nodes).toHaveLength(0);
    expect(r.pendingTurns).toBe(1);
  });

  it("tutor-introduced topics appear, and tutor turns never set shaky or solid", async () => {
    activeSessionSourceIds.mockResolvedValue(["s1"]);
    recentEvents.mockResolvedValue([
      turn("user", "chat", "Photosynthesis turns light energy into sugar"),
      turn("agent", "voice", "And what about the Calvin cycle?"),
      turn("agent", "chat", "The electron transport chain pumps protons across the membrane."),
    ]);
    await run();
    const calvin = nodeOf("calvin cycle");
    expect(calvin.evidence.some((e) => e.kind === "tutor" && e.quote.includes("Calvin cycle"))).toBe(true);
    expect(calvin.evidence.some((e) => e.kind === "student")).toBe(false);
    expect(calvin.status).toBe("mentioned"); // the model said "solid"
    expect(nodeOf("electron transport chain").status).toBe("mentioned"); // the model said "shaky"
    // A student turn can set it.
    expect(nodeOf("photosynthesis").status).toBe("solid");
    expectOneConnectedTree(db.doc);
  });

  it("does not use a quote from the wrong turn or a tutor quote as student evidence", async () => {
    llmJson.mockResolvedValue({
      nodes: [{ name: "calvin cycle", status: "shaky", evidence: [{ turn: 1, quote: "And what about the Calvin cycle?" }] }],
    });
    recentEvents.mockResolvedValue([turn("agent", "voice", "And what about the Calvin cycle?")]);
    await run();
    expect(nodeOf("calvin cycle").evidence.every((e) => e.kind === "tutor")).toBe(true);
    expect(nodeOf("calvin cycle").status).toBe("mentioned");
  });
});

describe("turns are consumed only once folded in", () => {
  it("a turn that yields no nodes stays pending, then is given up on after bounded attempts", async () => {
    llmJson.mockResolvedValue({ nodes: [] });
    recentEvents.mockResolvedValue([turn("user", "chat", "something about quantum tunnelling")]);
    let r = await run();
    expect(r.pendingTurns).toBe(1);
    expect(db.doc.processedEventIds).toEqual([]);
    expect(db.doc.attempts).toEqual({ e1: 1 });
    r = await run();
    expect(r.pendingTurns).toBe(1);
    r = await run();
    expect(r.pendingTurns).toBe(0);
    expect(db.doc.processedEventIds).toEqual(["e1"]);
    expect(llmJson).toHaveBeenCalledTimes(3);
  });

  it("a turn is retried and folded in once the model succeeds", async () => {
    recentEvents.mockResolvedValue([turn("user", "chat", "the spindle pulls chromosomes apart")]);
    llmJson.mockResolvedValueOnce({ nodes: [] });
    await run();
    llmJson.mockImplementation(fakeModel([{ when: /spindle/i, name: "spindle" }]));
    const r = await run();
    expect(r.pendingTurns).toBe(0);
    expect(nodeOf("spindle")).toBeTruthy();
    expect(db.doc.attempts).toEqual({});
  });

  it("does not lose a turn when the model call throws", async () => {
    llmJson.mockRejectedValue(new Error("model down"));
    recentEvents.mockResolvedValue([turn("user", "chat", "the spindle pulls chromosomes apart")]);
    await expect(run()).rejects.toThrow("model down");
    expect(db.doc?.processedEventIds ?? []).toEqual([]);
    expect(db.doc?.attempts ?? {}).toEqual({});
  });

  it("drains a backlog of more than 8 turns in one update", async () => {
    const names = Array.from({ length: 20 }, (_, i) => `widget ${i + 1}`);
    llmJson.mockImplementation(fakeModel(names.map((w) => ({ when: new RegExp(`${w}\\b`), name: w }))));
    recentEvents.mockResolvedValue(names.map((w) => turn("user", "chat", `we talked about ${w} today`)));
    const r = await run();
    expect(llmJson).toHaveBeenCalledTimes(3); // 8 + 8 + 4
    expect(r.pendingTurns).toBe(0);
    expect(db.doc.nodes).toHaveLength(20);
    expectOneConnectedTree(db.doc);
  });

  it("only picks up turns that are new since the last update", async () => {
    const first = [turn("user", "chat", "mitosis splits one cell in two")];
    llmJson.mockImplementation(fakeModel([{ when: /mitosis/i, name: "mitosis" }, { when: /spindle/i, name: "spindle" }]));
    recentEvents.mockResolvedValue(first);
    await run();
    recentEvents.mockResolvedValue([...first, turn("user", "chat", "the spindle pulls chromosomes apart")]);
    await run();
    expect(llmJson).toHaveBeenCalledTimes(2);
    expect(promptTurns().filter((l) => l.includes("mitosis splits"))).toHaveLength(1);
    expect(db.doc.nodes).toHaveLength(2);
  });
});

describe("reading the event log", () => {
  it("queries voice turns with a high limit, not the last 200 events of every type", async () => {
    recentEvents.mockResolvedValue([]);
    await run();
    const [sessionId, , limit, type] = recentEvents.mock.calls[0]; // (sessionId, userId, limit, type)
    expect(sessionId).toBe(SID);
    expect(type).toBe("voice_turn");
    expect(limit).toBeGreaterThanOrEqual(1000);
  });

  it("orders turns by event timestamp, whatever order the log returns them in", async () => {
    llmJson.mockImplementation(fakeModel([{ when: /mitosis/i, name: "mitosis" }, { when: /spindle/i, name: "spindle" }]));
    const a = turn("user", "chat", "mitosis splits one cell in two", 1);
    const b = turn("user", "voice", "the spindle pulls chromosomes apart", 2);
    const c = turn("agent", "chat", "Good. What happens next in anaphase?", 3);
    recentEvents.mockResolvedValue([c, b, a]); // shuffled
    await run();
    const lines = promptTurns();
    expect(lines[0]).toContain("mitosis splits");
    expect(lines[1]).toContain("spindle pulls");
    expect(lines[2]).toContain("tutor:");
    expect(db.doc.rootId).toBe("mitosis"); // earliest topic
  });
});
