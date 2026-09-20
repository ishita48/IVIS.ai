/**
 * Screen resolutions the Computer Use tool is told about.
 *
 * Client-safe on purpose. hooks/usePointer.ts needs this list to size the
 * capture and must not import lib/pointer.ts: that module calls Anthropic with
 * a server key and, through the token ledger, reaches the Mongo driver — which
 * cannot be bundled for the browser (PR #12 broke /live and /app this way).
 *
 * extension/background.js keeps a hand-synced mirror as GUIDE_RESOLUTIONS.
 */
export const SUPPORTED_RESOLUTIONS: {
  width: number;
  height: number;
  aspect: number;
}[] = [
  { width: 1024, height: 768, aspect: 1024 / 768 }, // 4:3   legacy
  { width: 1280, height: 800, aspect: 1280 / 800 }, // 16:10 most laptops
  { width: 1366, height: 768, aspect: 1366 / 768 }, // ~16:9 external monitors
];
