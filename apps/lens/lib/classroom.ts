/**
 * LENS Classroom — classes, rosters, and live activity that is actually live.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The teacher dashboard used to be entirely placeholder: 32 students, 18
 * online, 72% understanding, two invented questions. Numbers like that are
 * the fastest way to lose a room — a judge asks "is that real?" once and
 * every other number on the screen becomes suspect too.
 *
 * Everything here is a query. The roster is membership documents; the live
 * panel is an aggregation over the same `lens-events` index the student
 * side already writes to. Specifically:
 *
 *   online          distinct users with any event in the last 15 minutes
 *   understanding   the latest `understanding_noted` level per student,
 *                   bucketed — this is the tutor's own read, recorded at
 *                   the time, not a guess made later
 *   questions       real `voice_turn` rows where the student asked
 *                   something, most recent first
 *
 * WHEN THERE IS NO DATA, IT SAYS SO. An empty class reports zero and the
 * UI renders "no activity yet" rather than a plausible-looking split. A
 * dashboard that invents a 72% is worse than one that admits it is quiet.
 */

import {
  elasticPrimary,
  indexElasticDocument,
  queryElasticDocs,
  queryElasticEvents,
  updateElasticDoc,
} from "./elastic";
import type { LensEvent } from "./lens/contracts";

export type ClassDoc = {
  _id: string;
  ownerId: string;
  name: string;
  topic: string;
  /** Short code a student types to join. */
  joinCode: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Membership = {
  _id: string;
  classId: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  role: "teacher" | "student";
  /** `invited` until the person joins; `removed` is a soft delete. */
  status: "invited" | "active" | "removed";
  joinedAt: string;
};

export type ClassSession = {
  _id: string;
  classId: string;
  topic: string;
  date: string;
  time: string;
  maxStudents: number;
  location: string;
  resource: string;
  prompt: string;
  challenge: string;
  status: "scheduled" | "cancelled";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type LiveActivity = {
  online: number;
  roster: number;
  /** Counts, not percentages — the UI derives the split so 0/0 stays 0. */
  understanding: { solid: number; shaky: number; stuck: number };
  /** What students are actually asking the tutor, newest first. */
  questions: { text: string; at: string }[];
  /** Beliefs the tutor has named across the class, most frequent first. */
  struggles: { belief: string; count: number }[];
  activeSessions: number;
  sampledFrom: number;
};

/** Anything inside this window counts as "online now". */
const ONLINE_WINDOW_MS = 15 * 60 * 1000;

export function classroomEnabled(): boolean {
  return elasticPrimary();
}

/** Unambiguous characters only — this gets read aloud and typed in. */
export function generateJoinCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

const iso = () => new Date().toISOString();

// ── Classes ───────────────────────────────────────────────────────────

export async function createClass(input: {
  ownerId: string;
  name: string;
  topic?: string;
}): Promise<ClassDoc> {
  const id = crypto.randomUUID();
  const now = iso();
  const doc = {
    ownerId: input.ownerId,
    name: input.name.trim().slice(0, 120) || "Untitled class",
    topic: (input.topic || "").trim().slice(0, 120),
    joinCode: generateJoinCode(),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await indexElasticDocument("classes", id, doc);

  // The owner is a member too, so rosters and permissions have one shape.
  await addMember({
    classId: id,
    userId: input.ownerId,
    role: "teacher",
    status: "active",
  });

  return { _id: id, ...doc };
}

export async function listClasses(ownerId: string): Promise<ClassDoc[]> {
  const rows = await queryElasticDocs<ClassDoc>("classes", {
    filter: [{ term: { ownerId } }, { term: { archived: false } }],
    size: 50,
    sort: [{ updatedAt: "desc" }],
  });
  return rows ?? [];
}

export async function getClass(id: string): Promise<ClassDoc | null> {
  const rows = await queryElasticDocs<ClassDoc>("classes", {
    filter: [{ term: { _id: id } }],
    size: 1,
  });
  return rows?.[0] ?? null;
}

export async function findClassByCode(joinCode: string): Promise<ClassDoc | null> {
  const rows = await queryElasticDocs<ClassDoc>("classes", {
    filter: [{ term: { joinCode: joinCode.trim().toUpperCase() } }],
    size: 1,
  });
  return rows?.[0] ?? null;
}

export async function setClassTopic(id: string, topic: string): Promise<void> {
  await updateElasticDoc("classes", id, { topic: topic.slice(0, 120), updatedAt: iso() });
}

// ── Membership ────────────────────────────────────────────────────────

export async function addMember(input: {
  classId: string;
  userId?: string | null;
  email?: string | null;
  name?: string | null;
  role?: "teacher" | "student";
  status?: "invited" | "active";
}): Promise<Membership> {
  // Re-inviting or re-joining must not create a duplicate row, or the
  // roster count inflates every time someone clicks the link twice.
  const existing = await findMembership(input.classId, {
    userId: input.userId ?? undefined,
    email: input.email ?? undefined,
  });

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (input.userId && !existing.userId) patch.userId = input.userId;
    if (input.name && !existing.name) patch.name = input.name;
    if (input.status === "active" && existing.status !== "active") {
      patch.status = "active";
      patch.joinedAt = iso();
    }
    if (Object.keys(patch).length) {
      await updateElasticDoc("memberships", existing._id, patch);
    }
    return { ...existing, ...(patch as Partial<Membership>) };
  }

  const id = crypto.randomUUID();
  const doc = {
    classId: input.classId,
    userId: input.userId ?? null,
    email: (input.email ?? null)?.toLowerCase() ?? null,
    name: input.name ?? null,
    role: input.role ?? "student",
    status: input.status ?? "invited",
    joinedAt: iso(),
  };
  await indexElasticDocument("memberships", id, doc);
  return { _id: id, ...doc } as Membership;
}

async function findMembership(
  classId: string,
  by: { userId?: string; email?: string }
): Promise<Membership | null> {
  const filter: Record<string, unknown>[] = [{ term: { classId } }];
  if (by.userId) filter.push({ term: { userId: by.userId } });
  else if (by.email) filter.push({ term: { email: by.email.toLowerCase() } });
  else return null;

  const rows = await queryElasticDocs<Membership>("memberships", { filter, size: 1 });
  return rows?.[0] ?? null;
}

export async function listMembers(classId: string): Promise<Membership[]> {
  const rows = await queryElasticDocs<Membership>("memberships", {
    filter: [{ term: { classId } }],
    size: 500,
    sort: [{ joinedAt: "desc" }],
  });
  return rows ?? [];
}

export async function removeMember(classId: string, membershipId: string): Promise<void> {
  await updateElasticDoc("memberships", membershipId, {
    status: "removed",
    classId,
  });
}

/** Every class this user can see, whether they own it or joined it. */
export async function classesForUser(userId: string): Promise<ClassDoc[]> {
  const memberships = await queryElasticDocs<Membership>("memberships", {
    filter: [{ term: { userId } }],
    size: 100,
  });
  const ids = Array.from(new Set((memberships ?? []).map((m) => m.classId)));
  if (!ids.length) return [];

  const rows = await queryElasticDocs<ClassDoc>("classes", {
    filter: [{ terms: { _id: ids } }, { term: { archived: false } }],
    size: 100,
    sort: [{ updatedAt: "desc" }],
  });
  return rows ?? [];
}

// ── Sessions ──────────────────────────────────────────────────────────

export async function createSession(input: {
  classId: string;
  createdBy: string;
  topic: string;
  date?: string;
  time?: string;
  maxStudents?: number;
  location?: string;
  resource?: string;
  prompt?: string;
  challenge?: string;
}): Promise<ClassSession> {
  const id = crypto.randomUUID();
  const now = iso();
  const doc = {
    classId: input.classId,
    topic: input.topic.trim().slice(0, 120),
    date: (input.date || "").trim(),
    time: (input.time || "").trim(),
    maxStudents: Number.isFinite(input.maxStudents) ? Number(input.maxStudents) : 20,
    location: (input.location || "").trim(),
    resource: (input.resource || "").trim().slice(0, 500),
    prompt: (input.prompt || "").trim().slice(0, 2000),
    challenge: (input.challenge || "").trim(),
    status: "scheduled" as const,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await indexElasticDocument("classSessions", id, doc);
  return { _id: id, ...doc };
}

export async function listSessions(classId: string): Promise<ClassSession[]> {
  const rows = await queryElasticDocs<ClassSession>("classSessions", {
    filter: [{ term: { classId } }, { term: { status: "scheduled" } }],
    size: 100,
    sort: [{ date: "asc" }, { time: "asc" }],
  });
  return rows ?? [];
}

export async function cancelSession(classId: string, sessionId: string): Promise<void> {
  await updateElasticDoc("classSessions", sessionId, {
    classId,
    status: "cancelled",
    updatedAt: iso(),
  });
}

// ── Live activity, entirely derived ───────────────────────────────────

/**
 * One pass over the class's recent events. Deliberately a single query
 * with client-side folding rather than five aggregations: the roster is
 * tens of people, not thousands, and one round trip keeps the dashboard
 * responsive on venue Wi-Fi.
 */
export async function liveActivity(classId: string): Promise<LiveActivity> {
  const members = (await listMembers(classId)).filter((m) => m.status !== "removed");
  const studentIds = members
    .filter((m) => m.role === "student" && m.userId)
    .map((m) => m.userId as string);

  const empty: LiveActivity = {
    online: 0,
    roster: members.filter((m) => m.role === "student").length,
    understanding: { solid: 0, shaky: 0, stuck: 0 },
    questions: [],
    struggles: [],
    activeSessions: 0,
    sampledFrom: 0,
  };

  if (!studentIds.length) return empty;

  // Events across the whole roster. `queryElasticEvents` is per-user, so
  // gather in parallel and fold — still one round trip's worth of latency.
  const perStudent = await Promise.all(
    studentIds.map((userId) =>
      queryElasticEvents<LensEvent>({ userId, limit: 120, ascending: false }).catch(
        () => null
      )
    )
  );

  const since = Date.now() - ONLINE_WINDOW_MS;
  const online = new Set<string>();
  const sessions = new Set<string>();
  const latestLevel = new Map<string, number>();
  const questions: { text: string; at: string }[] = [];
  const beliefs = new Map<string, number>();
  let sampled = 0;

  perStudent.forEach((events, i) => {
    const userId = studentIds[i];
    for (const event of events ?? []) {
      sampled += 1;
      const at = new Date(event.timestamp).getTime();
      if (at >= since) {
        online.add(userId);
        if (event.sessionId) sessions.add(String(event.sessionId));
      }

      const payload = (event.payload ?? {}) as any;

      if (event.type === "understanding_noted" && !latestLevel.has(userId)) {
        const level = Number(payload.level);
        if (Number.isFinite(level)) latestLevel.set(userId, level);
      }

      // A student turn that ends in a question mark is a question they
      // asked the tutor. Cheap, and it never invents one.
      if (
        event.type === "voice_turn" &&
        payload.role === "user" &&
        typeof payload.text === "string" &&
        payload.text.trim().endsWith("?") &&
        questions.length < 8
      ) {
        questions.push({ text: payload.text.trim().slice(0, 180), at: event.timestamp });
      }

      if (event.type === "misconception_noted" && typeof payload.belief === "string") {
        const key = payload.belief.trim().slice(0, 140);
        if (key) beliefs.set(key, (beliefs.get(key) ?? 0) + 1);
      }
    }
  });

  const understanding = { solid: 0, shaky: 0, stuck: 0 };
  for (const level of latestLevel.values()) {
    if (level >= 0.7) understanding.solid += 1;
    else if (level >= 0.4) understanding.shaky += 1;
    else understanding.stuck += 1;
  }

  return {
    online: online.size,
    roster: empty.roster,
    understanding,
    questions,
    struggles: Array.from(beliefs.entries())
      .map(([belief, count]) => ({ belief, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    activeSessions: sessions.size,
    sampledFrom: sampled,
  };
}


// ── When the class is actually active ─────────────────────────────────

export type HeatCell = { day: number; hour: number; students: number };

/**
 * A real heatmap, replacing the invented availability grid.
 *
 * The old panel claimed to know when 32 students were *free*, which is not
 * something the product has ever asked anyone. This shows when they have
 * actually been working, which LENS does know because every surface writes
 * timestamped events — and for picking a review slot it is the better
 * question anyway: "when is this class already studying" beats "when did
 * they once say they were free".
 *
 * `day` is 0-6 from Sunday, `hour` is local 0-23, and the value is the
 * number of DISTINCT students active in that slot, not the event count —
 * otherwise one busy student outvotes ten quiet ones.
 */
export async function activityHeatmap(
  classId: string,
  opts: { days?: number } = {}
): Promise<{ cells: HeatCell[]; best: HeatCell | null; sampled: number }> {
  const members = (await listMembers(classId)).filter(
    (m) => m.status !== "removed" && m.role === "student" && m.userId
  );
  if (!members.length) return { cells: [], best: null, sampled: 0 };

  const since = Date.now() - (opts.days ?? 21) * 24 * 60 * 60 * 1000;

  const perStudent = await Promise.all(
    members.map((m) =>
      queryElasticEvents<LensEvent>({
        userId: m.userId as string,
        limit: 500,
        ascending: false,
      }).catch(() => null)
    )
  );

  // slot key -> set of userIds, so a slot counts people not events.
  const slots = new Map<string, Set<string>>();
  let sampled = 0;

  perStudent.forEach((events, i) => {
    const userId = members[i].userId as string;
    for (const event of events ?? []) {
      const at = new Date(event.timestamp);
      const ms = at.getTime();
      if (!Number.isFinite(ms) || ms < since) continue;
      sampled += 1;
      const key = `${at.getDay()}:${at.getHours()}`;
      if (!slots.has(key)) slots.set(key, new Set());
      slots.get(key)!.add(userId);
    }
  });

  const cells: HeatCell[] = Array.from(slots.entries()).map(([key, users]) => {
    const [day, hour] = key.split(":").map(Number);
    return { day, hour, students: users.size };
  });

  cells.sort((a, b) => b.students - a.students || a.day - b.day || a.hour - b.hour);

  return { cells, best: cells[0] ?? null, sampled };
}
