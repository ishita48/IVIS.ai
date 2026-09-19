/**
 * Clerk middleware. Everything under /app and /api is protected except the
 * extension endpoints, which authenticate by Clerk cookie inside the
 * handler because they are called cross-origin from the browser extension.
 */

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/sources/capture",
  // LENS Guide — the extension's service worker POSTs here from a
  // chrome-extension:// origin, so the route does its own auth check.
  "/api/guide/step",
  // Live voice tutor. Public so the demo has no sign-in step between
  // "open the laptop" and "the agent greets you".
  "/live",
  "/api/elevenlabs/signed-url",
  // Both vision endpoints — /live is public, so its API must be too.
  "/api/vision(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
