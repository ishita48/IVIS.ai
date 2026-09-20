/**
 * Which live-transcript entries still need saving as voice_turn events.
 * Client-safe. Several turns can land in one React render (the agent hook
 * appends them from separate callbacks), so "the last entry" is not enough:
 * every entry not yet recorded is returned, oldest first, and marked recorded.
 */
export function takeUnrecorded<T extends { id: string }>(transcript: T[], recorded: Set<string>): T[] {
  const fresh: T[] = [];
  for (const entry of transcript) {
    if (recorded.has(entry.id)) continue;
    recorded.add(entry.id);
    fresh.push(entry);
  }
  return fresh;
}
