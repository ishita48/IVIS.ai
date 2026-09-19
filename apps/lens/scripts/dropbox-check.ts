/**
 * Dropbox -> text, with no Clerk / Mongo / OpenAI needed.
 *
 *   cd apps/lens && npx tsx scripts/dropbox-check.ts [/folder]
 *
 * Lists the folder, downloads each readable file, runs it through the same extractors the
 * app uses, and prints how much text came out. If this works, the only untested part of
 * /api/dropbox/ingest is the database + embedding half.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: "../../.env" }); // the repo-root .env also holds the token
import { DropboxError, downloadFile, fileKind, listFiles } from "../lib/dropbox";
import { extractDocx, extractPdf, extractPlainText, extractXlsx } from "../lib/extract";

async function main() {
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) throw new Error("DROPBOX_ACCESS_TOKEN not found in apps/lens/.env.local or ../../.env");
  const folder = process.argv[2] ?? process.env.DROPBOX_NOTES_FOLDER ?? "/notes";

  const files = await listFiles(token, folder);
  console.log(`${files.length} file(s) in ${folder}:`);
  for (const f of files) {
    const kind = fileKind(f.name);
    if (!kind) { console.log(`  - ${f.path}  (skipped: unsupported type)`); continue; }
    const bytes = await downloadFile(token, f);
    const res =
      kind === "pdf" ? await extractPdf(bytes)
      : kind === "docx" ? await extractDocx(bytes)
      : kind === "xlsx" ? await extractXlsx(bytes)
      : extractPlainText(bytes);
    if (!res.ok) { console.log(`  - ${f.path}  FAILED: ${res.error}`); continue; }
    const preview = res.text.replace(/\s+/g, " ").slice(0, 90);
    console.log(`  - ${f.path}  ${res.text.length} chars, ${res.meta.pageCount ?? "?"} pages  "${preview}..."`);
  }
}

main().catch((e) => {
  console.error(e instanceof DropboxError ? `Dropbox error (${e.kind}): ${e.message}` : e);
  process.exit(1);
});
