/**
 * Mint a Dropbox refresh token.  `npm run dropbox:auth`
 * ─────────────────────────────────────────────────────────────────────
 *
 * Dropbox hands out two different things and the difference is the whole
 * reason this script exists. The button in the developer console gives a
 * short-lived `sl.` access token that dies after about four hours — which
 * is exactly how this integration broke: a console token was pasted into
 * DROPBOX_ACCESS_TOKEN, worked for one afternoon, and returned
 * expired_access_token forever after.
 *
 * A refresh token does not expire, and the only way to get one is the
 * authorisation-code flow with `token_access_type=offline`. Leave that
 * parameter off and Dropbox returns an access token with no refresh token
 * attached, silently, which is the trap this script exists to avoid.
 *
 * Run it twice: once with no argument to print the URL, then again with
 * the code Dropbox gives you.
 *
 *   npm run dropbox:auth
 *   npm run dropbox:auth -- <code>
 */

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const KEY = process.env.DROPBOX_APP_KEY;
const SECRET = process.env.DROPBOX_APP_SECRET;

function die(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

async function main() {
  if (!KEY || !SECRET) {
    die(
      [
        "DROPBOX_APP_KEY and DROPBOX_APP_SECRET must be in apps/lens/.env.local first.",
        "",
        "Get them from https://www.dropbox.com/developers/apps — open your app,",
        "then the Settings tab. They are under 'App key' and 'App secret'.",
      ].join("\n")
    );
  }

  const code = process.argv[2]?.trim();

  // ── Step one: the URL ─────────────────────────────────────────────
  if (!code) {
    const url =
      `https://www.dropbox.com/oauth2/authorize` +
      `?client_id=${encodeURIComponent(KEY)}` +
      `&response_type=code` +
      // Without this there is no refresh token in the reply, and the whole
      // exercise silently produces another 4-hour token.
      `&token_access_type=offline`;

    console.log(
      [
        "",
        "1. Before anything else, check the app's Permissions tab has these ticked",
        "   and that you pressed Submit:",
        "",
        "      files.metadata.read      files.content.read",
        "",
        "   Scopes are baked into the token at this step. Granting them afterwards",
        "   does nothing to a token you already minted.",
        "",
        "2. Open this and click Allow:",
        "",
        `   ${url}`,
        "",
        "3. Dropbox shows you a code. Run:",
        "",
        "      npm run dropbox:auth -- <the code>",
        "",
      ].join("\n")
    );
    return;
  }

  // ── Step two: trade the code for a refresh token ──────────────────
  const res = await fetch("https://api.dropbox.com/oauth2/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ code, grant_type: "authorization_code" }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    error_description?: string;
    error?: string;
  };

  if (!res.ok) {
    const why = json.error_description || json.error || String(res.status);
    die(
      /expired|invalid_grant/i.test(why)
        ? `Dropbox refused the code: ${why}\n\nCodes are single-use and expire within minutes. Run the script again with no argument and use the new code straight away.`
        : `Dropbox refused the code: ${why}`
    );
  }

  if (!json.refresh_token) {
    die(
      [
        "Dropbox returned an access token but NO refresh token.",
        "",
        "That means token_access_type=offline was missing from the authorise URL —",
        "use the URL this script prints rather than one from the console.",
      ].join("\n")
    );
  }

  // Verify it before telling anyone it works.
  const check = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: { authorization: `Bearer ${json.access_token}` },
  });
  const who = (await check.json().catch(() => ({}))) as {
    name?: { display_name?: string };
    email?: string;
  };

  console.log(
    [
      "",
      check.ok
        ? `Works. Signed in as ${who?.name?.display_name ?? "?"} <${who?.email ?? "?"}>`
        : `Token minted, but the account check returned ${check.status}. Check the Permissions tab.`,
      "",
      `Scopes: ${json.scope ?? "(none reported)"}`,
      "",
      "Put this in apps/lens/.env.local, replacing the existing line:",
      "",
      `   DROPBOX_REFRESH_TOKEN=${json.refresh_token}`,
      "",
      "Then RESTART the dev server — Next reads .env.local once, at startup.",
      "DROPBOX_ACCESS_TOKEN can be blanked; it is only a fallback now.",
      "",
      "Verify with:  npm run dropbox:check",
      "",
    ].join("\n")
  );
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
