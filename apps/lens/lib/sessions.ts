/**
 * LENS Sessions — the sidebar, on Elastic.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Sessions were the last thing in the app that needed a relational store,
 * and needing one meant an Atlas outage emptied the sidebar — which in turn
 * made `bootstrap()` fail to resume, so every reload looked like a brand
 * new chat. That is the bug this file exists to remove.
 *
 * The behaviour it implements is deliberately the one people already know
 * from ChatGPT:
 *
 *   - reload            → the same session, still there
 *   - sign in elsewhere → your most recent session, not an empty one
 *   - New session       → appears in the sidebar immediately
 *   - first message     → the session names itself
 *
 * `updatedAt` is what orders the list, so "most recent" means most recently
 * worked in, not most recently created.
 */

import {
  elasticPrimary,
  indexElasticDocument,
  queryElasticDocs,
  updateElasticDoc,
} from "./elastic";
import { classesForUser, type ClassDoc } from "./classroom";

export const DEFAULT_TITLE = "New session";

export type SessionDoc = {
  _id: string;
  userId: string;
  title: string;
  /** True until the session has named itself from real content. */
  untitled: boolean;
  status: "active" | "archived";
  surface: string;
  createdAt: string;
  updatedAt: string;
  /** Set on a circle's shared room; absent on a private session. */
  classId?: string | null;
  shared?: boolean;
  /** Filled in by listSessions so the sidebar can label the group. */
  circleName?: string | null;
};

export function sessionsOnElastic(): boolean {
  return elasticPrimary();
}

/**
 * The sidebar's sessions: this user's own, plus the shared room of every
 * circle they belong to.
 *
 * A circle's room is owned by the circle's owner, so filtering on userId
 * alone means a member never sees the group they just joined — they are
 * in it, they can open it from the link, and it is absent from their
 * sidebar the moment they navigate away. The rooms are fetched by id from
 * the circles this account is a member of, which is the same membership
 * check the session read path uses, so nothing is visible here that could
 * not already be opened.
 *
 * Rooms are tagged with `classId` and `circleName` so the sidebar can file
 * them under Groups rather than mixing them into personal history.
 */
export async function listSessions(
  userId: string,
  limit = 50
): Promise<SessionDoc[]> {
  const [own, circles] = await Promise.all([
    queryElasticDocs<SessionDoc>("sessions", {
      filter: [{ term: { userId } }, { term: { status: "active" } }],
      size: limit,
      sort: [{ updatedAt: "desc" }],
    }),
    classesForUser(userId).catch(() => [] as ClassDoc[]),
  ]);

  const mine = own ?? [];
  if (!circles.length) return mine;

  const rooms = await queryElasticDocs<SessionDoc>("sessions", {
    filter: [
      { terms: { classId: circles.map((c: ClassDoc) => c._id) } },
      { term: { shared: true } },
    ],
    size: 50,
    sort: [{ updatedAt: "desc" }],
  }).catch(() => []);

  const nameFor = new Map(circles.map((c: ClassDoc) => [c._id, c.name] as const));
  const seen = new Set(mine.map((s: any) => String(s._id)));

  const shared = (rooms ?? [])
    .filter((r) => !seen.has(String((r as any)._id)))
    .map((r) => ({
      ...r,
      circleName: nameFor.get(String((r as any).classId)) ?? "Circle",
    }));

  // A room the student owns is already in `mine`; tag it there too, so a
  // circle's creator files it under Groups like everyone else does.
  for (const s of mine as any[]) {
    if (s.classId && !s.circleName) s.circleName = nameFor.get(String(s.classId)) ?? "Circle";
  }

  return [...(mine as any[]), ...shared].sort((a: any, b: any) =>
    String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))
  );
}

export async function getSession(
  userId: string,
  id: string
): Promise<SessionDoc | null> {
  const rows = await queryElasticDocs<SessionDoc>("sessions", {
    filter: [{ term: { _id: id } }, { term: { userId } }],
    size: 1,
  });
  return rows?.[0] ?? null;
}

export async function createSession(
  userId: string,
  title = DEFAULT_TITLE
): Promise<SessionDoc> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const doc = {
    userId,
    title,
    untitled: title === DEFAULT_TITLE,
    status: "active" as const,
    surface: "lens",
    createdAt: now,
    updatedAt: now,
  };
  await indexElasticDocument("sessions", id, doc);
  return { _id: id, ...doc };
}

/**
 * Clicking "New session" twice in a row should not leave an empty session
 * behind. If the newest session is still untitled and nothing has been
 * written into it, hand that one back instead of making another.
 */
export async function createOrReuseEmpty(userId: string): Promise<SessionDoc> {
  const [newest] = await listSessions(userId, 1);
  if (newest?.untitled && newest.title === DEFAULT_TITLE) {
    const hasContent = await sessionHasContent(userId, newest._id);
    if (!hasContent) return newest;
  }
  return createSession(userId);
}

/** Has anything actually happened in this session? */
async function sessionHasContent(userId: string, sessionId: string) {
  const { queryElasticEvents } = await import("./elastic");
  const rows = await queryElasticEvents<{ _id: string }>({
    userId,
    sessionId,
    limit: 1,
  }).catch(() => null);
  return !!rows?.length;
}

export async function renameSession(
  userId: string,
  id: string,
  title: string
): Promise<boolean> {
  const session = await getSession(userId, id);
  if (!session) return false;
  await updateElasticDoc("sessions", id, {
    title: title.slice(0, 120),
    untitled: false,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

export async function archiveSession(userId: string, id: string): Promise<boolean> {
  const session = await getSession(userId, id);
  if (!session) return false;
  await updateElasticDoc("sessions", id, {
    status: "archived",
    updatedAt: new Date().toISOString(),
  });
  return true;
}

/** Bump `updatedAt` so the sidebar orders by recent activity. */
export async function touchSession(userId: string, id: string): Promise<void> {
  await updateElasticDoc("sessions", id, {
    updatedAt: new Date().toISOString(),
  }).catch(() => undefined);
}

/**
 * Name a session from the first thing said in it.
 *
 * Only ever applies to a session still flagged `untitled`, so a title the
 * student chose is never overwritten by a later message. The model gets one
 * cheap call; if it fails or returns something useless, the fallback is a
 * trim of what they actually said, which is not a worse title than "New
 * session" and costs nothing.
 */
export async function autoTitleSession(
  userId: string,
  id: string,
  firstMessage: string
): Promise<string | null> {
  const session = await getSession(userId, id);
  if (!session || !session.untitled) return null;

  const text = firstMessage.trim();
  if (text.length < 4) return null;

  let title = "";
  try {
    const { llmJson } = await import("./llm");
    const out = await llmJson<{ title: string }>(
      "You name study sessions. Reply with JSON only.",
      `Give this study session a title of at most five words, in plain nouns, naming the subject the student is working on. No quotes, no punctuation at the end, no "Session" or "Help with" prefix.\n\nFirst thing they said: "${text.slice(0, 400)}"\n\nRespond as {"title": string}.`,
      // Pinned to OpenAI: the Gemma primary answers this one in prose
      // ("Constraint 1: Title of at most five words...") rather than JSON,
      // so llmJson parses, throws, and falls through — making every title
      // cost two model calls. A title is a tiny, latency-visible call on a
      // path the student is watching; it gets the provider that returns
      // the shape first time.
      { temperature: 0.2, maxTokens: 60, thinking: "off", provider: "openai" }
    );
    title = String(out?.title || "").trim();
  } catch {
    /* fall through to the trim */
  }

  if (!title || title.length > 60) {
    title = text.length > 48 ? `${text.slice(0, 45).trimEnd()}…` : text;
  }

  await updateElasticDoc("sessions", id, {
    title,
    untitled: false,
    updatedAt: new Date().toISOString(),
  });

  return title;
}
