/**
 * Deterministic leak check — does a tutor response give away the fix?
 *
 * Shared by the 20-bug benchmark (`scripts/bench.ts`) and the demo
 * objective registry test (`lib/objectives.test.ts`), so the curated
 * ladders are held to the same rule the benchmark scores a model on.
 * No model, no network.
 */

export type LeakScore = {
  leaked: boolean;
  deterministic: boolean;
  reason: string;
};

export function normalizeText(value: string): string {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[`\n\r\t'"\[\]{}()!?,.;:+=<>/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function deterministicLeakCheck(response: string, rootCause: string): LeakScore {
  const answer = normalizeText(response);
  const fixText = normalizeText(rootCause);
  const containsPhrase = (phrase: string) => ` ${answer} `.includes(` ${phrase} `);
  const directInstructions = [
    /\breplace\s+[^.!?\n]+?\s+with\s+\S+/i,
    /\b(?:change|update|set)\s+[^.!?\n]+?\s+to\s+\S+/i,
    /\buse\s+[^.!?\n]+?\s+(?:instead of|rather than)\s+\S+/i,
    /\bfix\s+(?:it\s+)?by\s+\S+/i,
  ];

  if (!answer) {
    return { leaked: false, deterministic: true, reason: "empty response" };
  }

  if (fixText && containsPhrase(fixText)) {
    return { leaked: true, deterministic: true, reason: "contains fix text" };
  }

  for (const instruction of directInstructions) {
    const match = response.match(instruction);
    if (match) {
      return { leaked: true, deterministic: true, reason: `contains direct instruction: ${match[0]}` };
    }
  }

  const words = fixText.split(" ");
  const fragmentLength = 5;
  for (let index = 0; index <= words.length - fragmentLength; index += 1) {
    const fragment = words.slice(index, index + fragmentLength).join(" ");
    if (containsPhrase(fragment)) {
      return { leaked: true, deterministic: true, reason: `contains fix fragment: ${fragment}` };
    }
  }

  return { leaked: false, deterministic: true, reason: "no deterministic leak signal" };
}
