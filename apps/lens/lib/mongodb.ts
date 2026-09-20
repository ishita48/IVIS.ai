/**
 * MongoDB — the secondary store, behind a circuit breaker.
 * ─────────────────────────────────────────────────────────────────────
 *
 * LENS runs on Elastic. Mongo is kept for the routes that still write
 * relational-ish documents (sources, sessions, groups), and every one of
 * those paths already falls back to Elastic when this is unreachable.
 *
 * Two things here exist because of what actually happens on venue Wi-Fi:
 *
 *   1. NO CONNECTION AT MODULE LOAD. The driver used to `client.connect()`
 *      as a side effect of importing this file, which meant a dead SRV
 *      record produced a `querySrv ECONNREFUSED` every four seconds for
 *      the life of the dev server — in the logs you are trying to read on
 *      stage. Connecting lazily means an outage costs one error per call
 *      site, not a stream.
 *
 *   2. A CIRCUIT BREAKER. Once a connection attempt fails, every caller
 *      for the next cooldown fails immediately instead of waiting out the
 *      driver's own timeout. A route that degrades to Elastic should
 *      degrade in milliseconds; a ten-second stall per request is
 *      indistinguishable from the app being broken.
 *
 * `getDb()` still throws when Mongo is down. That is deliberate — callers
 * catch it and use Elastic. Returning a fake db would hide the outage and
 * silently drop writes.
 */

import { MongoClient, MongoClientOptions } from "mongodb";
import dns from "node:dns";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI environment variable is not set");
}

/**
 * Only the `dns.resolve*` family honours this — `dns.lookup`, and so
 * `fetch`, keeps using the OS resolver. It therefore affects the driver's
 * SRV lookup for `mongodb+srv://` and nothing else in the app.
 */
const dnsServers = (process.env.MONGODB_DNS_SERVERS || "")
  .split(",")
  .map((server) => server.trim())
  .filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);

const uri = process.env.MONGODB_URI;

const options: MongoClientOptions = {
  maxPoolSize: 20,
  minPoolSize: 0,
  maxIdleTimeMS: 60000,
  // Short on purpose: the caller has an Elastic path to fall back to, and
  // the default 30s selection timeout turns a degraded route into a hung one.
  serverSelectionTimeoutMS: 4000,
  connectTimeoutMS: 4000,
  socketTimeoutMS: 45000,
  retryWrites: true,
  retryReads: true,
  w: "majority",
  readPreference: "primaryPreferred",
  compressors: ["zstd", "snappy"],
};

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
  var _mongoBreakerUntil: number | undefined;
  var _mongoLastError: string | undefined;
}

/** How long to stop trying after a failed connection. */
const COOLDOWN_MS = 60_000;

function breakerOpen(): boolean {
  return (globalThis._mongoBreakerUntil ?? 0) > Date.now();
}

function tripBreaker(error: unknown) {
  globalThis._mongoBreakerUntil = Date.now() + COOLDOWN_MS;
  globalThis._mongoLastError = (error as Error)?.message || String(error);
  globalThis._mongoClientPromise = undefined;
  console.warn(
    `[mongodb] unreachable, pausing attempts for ${COOLDOWN_MS / 1000}s: ${globalThis._mongoLastError}`
  );
}

/** Connect on demand. Reuses the connection across hot reloads in dev. */
function connect(): Promise<MongoClient> {
  if (!globalThis._mongoClientPromise) {
    const client = new MongoClient(uri, options);
    globalThis._mongoClientPromise = client.connect().catch((error) => {
      tripBreaker(error);
      throw error;
    });
  }
  return globalThis._mongoClientPromise;
}

export async function getDb() {
  if (breakerOpen()) {
    throw new Error(
      `Mongo is unreachable (last error: ${globalThis._mongoLastError ?? "unknown"}). Using the Elastic path.`
    );
  }
  const client = await connect();
  return client.db(process.env.MONGODB_DB ?? "lens");
}

/** For /api/status — does not attempt a connection when the breaker is open. */
export async function mongoAvailable(): Promise<{ ok: boolean; error?: string }> {
  if (breakerOpen()) return { ok: false, error: globalThis._mongoLastError };
  try {
    const client = await connect();
    await client.db("admin").command({ ping: 1 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Kept for callers that want the client itself. Lazy, like everything else. */
export default {
  then: (...args: Parameters<Promise<MongoClient>["then"]>) => connect().then(...args),
} as unknown as Promise<MongoClient>;

export async function withTransaction<T>(
  fn: (session: any) => Promise<T>
): Promise<T> {
  const client = await connect();
  const session = client.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
