/**
 * Clerk middleware. Everything under /app and /api is protected except the
 * extension capture endpoint, which authenticates by Clerk cookie inside
 * the handler because it is called cross-origin from the browser extension.
 */

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/sources/capture",
  // Live voice tutor. Public so the demo has no sign-in step between
  // "open the laptop" and "the agent greets you".
  "/live",
  "/api/elevenlabs/signed-url",
  "/api/vision/analyze",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
