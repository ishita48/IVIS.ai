/**
 * Minimal Dropbox HTTP client for the Sources tier. No SDK: two endpoints, plain fetch,
 * so there is no new dependency to install or audit.
 *
 * Auth is a bearer token from DROPBOX_ACCESS_TOKEN. Tokens made in the Dropbox developer
 * console expire after ~4 hours, so DropboxError carries a `kind` the route can turn into
 * a message a human can act on.
 */

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";

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
      "Dropbox rejected the token. Tokens from the developer console expire after about 4 hours: generate a new one and update DROPBOX_ACCESS_TOKEN.",
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

async function rpc(token: string, path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res);
  return res.json();
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

export async function downloadFile(token: string, file: Pick<DropboxFile, "id">): Promise<Buffer> {
  const res = await fetch(`${CONTENT}/files/download`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "dropbox-api-arg": JSON.stringify({ path: file.id }), // ids are ASCII-safe, paths may not be
    },
  });
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
