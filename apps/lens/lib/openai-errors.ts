export function formatOpenAIError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("insufficient_quota") ||
    normalized.includes("quota") ||
    normalized.includes("billing") ||
    normalized.includes("exceeded your current quota")
  ) {
    return "OpenAI quota is exhausted. Add billing or replace OPENAI_API_KEY in apps/lens/.env.local, then restart the dev server.";
  }

  if (
    normalized.includes("rate_limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  ) {
    return "OpenAI is temporarily rate-limiting requests. Wait a moment and try again.";
  }

  if (normalized.includes("invalid_api_key") || normalized.includes("incorrect api key")) {
    return "OPENAI_API_KEY is invalid. Replace it in apps/lens/.env.local, then restart the dev server.";
  }

  return message || "OpenAI request failed.";
}

export function openAIErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("insufficient_quota") ||
    normalized.includes("quota") ||
    normalized.includes("billing") ||
    normalized.includes("rate_limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  ) {
    return 429;
  }

  if (normalized.includes("invalid_api_key") || normalized.includes("incorrect api key")) {
    return 503;
  }

  return 500;
}
