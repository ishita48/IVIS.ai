/**
 * Minimal Dropbox HTTP client for the Sources tier. No SDK: a handful of
 * endpoints and plain fetch, so there is no new dependency to audit.
 *
 * AUTH IS THE WHOLE STORY HERE. This used to read DROPBOX_ACCESS_TOKEN and
 * pass it around. Tokens minted in the Dropbox console are `sl.` tokens
 * that expire after about four hours, so Dropbox worked for one afternoon
 * and then returned expired_access_token forever — which is exactly the
 * state it was found in, with a 1,500-character token that Dropbox had
 * already invalidated.
 *
 * A refresh token does not expire. With DROPBOX_APP_KEY, DROPBOX_APP_SECRET
 * and DROPBOX_REFRESH_TOKEN set, getAccessToken() mints a short-lived
 * access token on demand and caches it in module memory until shortly
 * before it lapses, so a running server refreshes itself and nobody has to
 * remember to paste a new token before a demo.
 *
 * DROPBOX_ACCESS_TOKEN still works as a fallback for a quick manual test,
 * and the errors say which of the two is missing rather than reporting a
 * bare 401.
 */

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
const OAUTH = "https://api.dropbox.com/oauth2/token";

/** Refreshed access token, held only in memory. */
let cached: { token: string; expiresAt: number } | null = null;

/** Refresh this long before the token actually lapses. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

export function dropboxConfigured(): boolean {
  return !!(
    (process.env.DROPBOX_REFRESH_TOKEN &&
      process.env.DROPBOX_APP_KEY &&
      process.env.DROPBOX_APP_SECRET) ||
    process.env.DROPBOX_ACCESS_TOKEN
  );
}

/**
 * A usable bearer token, minted from the refresh token when one is
 * configured and reused until it is nearly expired.
 *
 * `force` throws the cache away, which is what the 401 retry does: a token
 * can lapse between being handed out and being used, and one silent
 * re-mint is much better than an error the student has to read.
 */
export async function getAccessToken(force = false): Promise<string> {
  const refresh = process.env.DROPBOX_REFRESH_TOKEN;
  const key = process.env.DROPBOX_APP_KEY;
  const secret = process.env.DROPBOX_APP_SECRET;

  if (!refresh || !key || !secret) {
    const stat = process.env.DROPBOX_ACCESS_TOKEN;
    if (stat) return stat.replace(/^"|"$/g, "");
    throw new DropboxError(
      "Dropbox is not connected. Set DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN.",
      "auth",
      503
    );
  }

  if (!force && cached && Date.now() < cached.expiresAt) return cached.token;

  const res = await fetch(OAUTH, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    cached = null;
    // invalid_grant is the one worth naming: it means the refresh token was
    // revoked or belongs to a different app, and no amount of retrying will
    // fix it. Anything else is worth a retry.
    const revoked = json.error === "invalid_grant";
    throw new DropboxError(
      revoked
        ? "Dropbox rejected the refresh token as invalid or revoked. Generate a new one for this app and update DROPBOX_REFRESH_TOKEN."
        : `Dropbox refused to refresh the token: ${json.error_description || json.error || res.status}`,
      "auth",
      401
    );
  }

  cached = {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(60_000, (json.expires_in ?? 14_400) * 1000 - EXPIRY_MARGIN_MS),
  };
  return cached.token;
}

export type DropboxFile = {
  id: string;
  name: string;
  path: string; // display path, e.g. /notes/Lecture1.pdf
  size: number;
  contentHash: string; // changes when the file's bytes change: our "did it change?" check
};

export class DropboxError extends Error {
  kind: "auth" | "not_found" | "rate_limit" | "other";
  status: number;
  constructor(message: string, kind: DropboxError["kind"], status: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** Dropbox wants "" for the root, never "/", and a leading slash on everything else. */
export function normalizeFolder(folder: string | undefined | null): string {
  const f = (folder ?? "").trim();
  if (!f || f === "/") return "";
  return (f.startsWith("/") ? f : `/${f}`).replace(/\/+$/, "");
}

async function fail(res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  if (res.status === 401) {
    throw new DropboxError(
      canRefresh()
        ? "Dropbox rejected the refreshed token. Check that DROPBOX_APP_KEY and DROPBOX_APP_SECRET belong to the same app as the refresh token."
        : "Dropbox rejected the token. Console tokens expire after about 4 hours — set DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN so it refreshes itself.",
      "auth",
      401
    );
  }
  if (res.status === 409 && body.includes("not_found")) {
    throw new DropboxError("That folder does not exist in Dropbox (or the app cannot see it).", "not_found", 409);
  }
  if (res.status === 429) {
    throw new DropboxError("Dropbox is rate limiting us. Wait a minute and try again.", "rate_limit", 429);
  }
  throw new DropboxError(`Dropbox ${res.status}: ${body.slice(0, 300)}`, "other", res.status);
}

async function rpc(token: string, path: string, body: unknown, retried = false): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && !retried && canRefresh()) {
    return rpc(await getAccessToken(true), path, body, true);
  }
  if (!res.ok) await fail(res);
  return res.json();
}

/** Whether a 401 is worth one silent retry, or is simply the end of it. */
function canRefresh(): boolean {
  return !!(
    process.env.DROPBOX_REFRESH_TOKEN &&
    process.env.DROPBOX_APP_KEY &&
    process.env.DROPBOX_APP_SECRET
  );
}

/** Every file under `folder`, subfolders included. Follows pagination. */
export async function listFiles(token: string, folder: string): Promise<DropboxFile[]> {
  const out: DropboxFile[] = [];
  let page = await rpc(token, "/files/list_folder", {
    path: normalizeFolder(folder),
    recursive: true,
    limit: 200,
  });
  for (;;) {
    for (const e of page.entries as any[]) {
      if (e[".tag"] !== "file") continue;
      out.push({
        id: e.id,
        name: e.name,
        path: e.path_display ?? e.name,
        size: e.size ?? 0,
        contentHash: e.content_hash ?? "",
      });
    }
    if (!page.has_more) break;
    page = await rpc(token, "/files/list_folder/continue", { cursor: page.cursor });
  }
  return out;
}

export async function downloadFile(
  token: string,
  file: Pick<DropboxFile, "id">,
  retried = false
): Promise<Buffer> {
  const res = await fetch(`${CONTENT}/files/download`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "dropbox-api-arg": JSON.stringify({ path: file.id }), // ids are ASCII-safe, paths may not be
    },
  });
  if (res.status === 401 && !retried && canRefresh()) {
    return downloadFile(await getAccessToken(true), file, true);
  }
  if (!res.ok) await fail(res);
  return Buffer.from(await res.arrayBuffer());
}

/** Kinds the existing extraction pipeline (lib/extract.ts) can read. */
export function fileKind(name: string): "pdf" | "docx" | "xlsx" | "text" | null {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".xlsx")) return "xlsx";
  if (/\.(txt|md|csv|tsv)$/.test(n)) return "text";
  return null;
}
