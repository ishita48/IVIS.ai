/**
 * Which turns can carry a topic. Client-safe (no server imports): the store,
 * the camera view and the concept-map builder all share this one rule.
 *
 * The test is content, not length: "ATP" is a complete answer, "ok thanks" is
 * not. A turn is dropped only when every word in it is filler.
 */

const FILLER = new Set([
  "a", "ah", "aha", "alright", "am", "and", "are", "awesome", "bye", "cool", "dont", "erm", "fine", "go", "good",
  "got", "great", "hello", "hey", "hi", "hm", "hmm", "huh", "i", "idk", "is", "it", "its", "know", "let", "lets",
  "like", "mhm", "nice", "no", "nope", "not", "now", "ok", "okay", "please", "right", "so", "sorry", "sounds",
  "sure", "thank", "thanks", "that", "the", "then", "um", "uh", "well", "yeah", "yep", "yes", "you", "s", "t",
  "continue", "next", "again", "repeat", "wait", "what", "oh", "gotcha", "understood", "makes", "sense", "cheers",
]);

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** True when the turn has at least one word that is not filler. */
export function hasTopicContent(text: string): boolean {
  return wordsOf(String(text ?? "")).some((w) => !FILLER.has(w));
}
