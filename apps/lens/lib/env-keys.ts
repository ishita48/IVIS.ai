/**
 * Is this environment value a real credential, or the placeholder that
 * shipped in .env.example?
 *
 * `.env.local` carries lines like `ANTHROPIC_API_KEY=sk-ant-...` and
 * `GOOGLE_API_KEY=...` until someone pastes a key. Those are truthy, so a
 * plain `!!process.env.X` reports the feature as configured, the UI shows
 * it as live, and the first real call dies with a 401 that looks like a
 * network bug. Treating a placeholder as unset makes the route say
 * "not configured" up front, which is the message that gets a key pasted.
 */
export function realKey(value: string | undefined | null): string | null {
  const v = (value ?? "").trim().replace(/^"(.*)"$/, "$1");
  if (!v) return null;
  if (v.includes("...") || v.includes("…")) return null;
  if (/^(your|paste|replace|todo|changeme|xxx)/i.test(v)) return null;
  if (v.length < 16) return null;
  return v;
}

export function hasRealKey(...names: string[]): boolean {
  return names.some((n) => realKey(process.env[n]) !== null);
}
