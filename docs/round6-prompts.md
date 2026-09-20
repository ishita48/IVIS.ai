# Round 6 prompts — end-to-end, cleanup, UX

Written 2026-09-20 ~05:10. Isha is testing the extension by hand. Everything below runs in its own
Claude Code session on its own branch, concurrently. All start from the current working tree (13
modified files, uncommitted): commit it first as one "Round 6 base" commit, or every session will
see the same dirty tree.

Prerequisite for anything that calls a model: paste a real `ANTHROPIC_API_KEY` and `GOOGLE_API_KEY`
into `apps/lens/.env.local`. Both are placeholders right now and the app now says so out loud.

## Prompt A: end-to-end test run

```text
Branch off main as test/e2e-round6. Read docs/mvp-test-scripts.md fully. Run sections 1, 4 and 5 end to end against the dev server on port 3000 using the built-in browser. Stop at the Clerk page and ask me to sign in, then continue. For voice steps, tell me exactly what to say and wait for me. Record every step as pass or fail with the proving console line, network response or screenshot, in a table. Do not fix anything in this session: for each failure write a one-paragraph bug report with the file you believe is responsible and paste all of them at the end under "Bugs found". Also run `npm run pointer:check` in apps/lens and include its output verbatim. Do not commit.
```

## Prompt B: cleanup

```text
Branch off main as chore/cleanup-round6. Scope: dead code and stale docs only, no behaviour changes. Work through this list and nothing else: (1) apps/lens/.env.local has NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY twice; keep the second pair, delete the first, and mirror the fix in any .env.example. (2) lib/deepgram.ts: confirm with grep whether anything under app/, components/ or hooks/ imports it now; if nothing does, say so and leave it, since docs/round5-prompts.md may re-mount it. (3) Delete apps/lens/tsconfig.tsbuildinfo from git if tracked and add it to .gitignore. (4) ELEVENLABS_AGENT.md section 6 says "open http://localhost:3001/live"; /live no longer exists, so change it to /app and the Camera tab. (5) Search the repo for "StudiO", "StudyO", "study-o-two.vercel.app" and "/live" and list every hit; fix the ones in user-facing copy and docs, leave the deploy URL in extension/content.js LENS_ORIGINS alone unless a replacement deploy URL exists. (6) Run `npx tsc --noEmit`, `npx vitest run` and `npm run boundary` in apps/lens. Report every file touched with one line each. Do not commit.
```

## Prompt C: UX pass on the Camera tab

```text
Branch off main as ux/camera-tab. Scope: components/Camera/CameraView.tsx and components/Camera/SessionSummary.tsx only; another session owns components/product/*. Load the frontend-design skill first. The Camera card currently stacks, top to bottom: the video, a "not connected" label plus a socratic/guided/explain chip row, a five-button row (Reference, Sessions, Think aloud, Look, Start Session), two lines of privacy copy, a "check in if I go quiet" checkbox, a "Saved as" banner, the Session summary card, and the Last look card. A judge cannot tell which button starts the demo. Make these changes: (1) Start Session is the one primary button; Look is secondary next to it; Reference, Sessions and Think aloud go into a single "More" menu or an icon row with tooltips. (2) The connection state reads "Ready to start", "Listening", "Thinking" or "Speaking", never "not connected". (3) The mode chips get a one-line hint under them, e.g. "socratic: asks only, guided: names the idea, explain: teaches the concept", or move into the More menu with the same hint. (4) The privacy line and the check-in checkbox collapse into one short line with an info icon. (5) SessionSummary's empty state is one sentence that says what produces a curve, and it does not render at all until a session has ended. (6) Nothing else moves; do not touch the transcript column. Run typecheck and vitest. Report before and after as a list of what is on screen top to bottom. Do not commit.
```

## Prompt D: landing page knows you are signed in

```text
Branch off main as fix/landing-signed-in. Scope: the marketing landing under components/landing/* and app/page.tsx only. Bug: a signed-in student who lands on "/" sees "Sign in" and "Get started" as if logged out, which is how the logo-to-landing loop felt like a forced re-login. Use Clerk's <SignedIn> / <SignedOut> (or the auth() helper server-side) so a signed-in visitor sees "Open workspace" linking to /app in place of "Sign in", and "Start learning" also goes to /app. Keep the logged-out landing exactly as it is. Verify with `npx tsc --noEmit` and by loading "/" logged out in the built-in browser. Do not commit.
```

## UX recommendations not turned into prompts yet

- The left chat sidebar's intro paragraph and three chips (Open the camera, Add a source, What can you see?) duplicate the Camera card's own controls. One entry point is enough; the sidebar could show recent sessions only.
- Transcript labels YOU / LENS are fine, but the tutor's pre-tool line ("Let me take a look") and its post-tool line rendered as two turns. The prompt now forbids the first one; if it persists, collapse consecutive LENS turns visually.
- The five ladder rungs are a scripted beat, but the Reasoning tab draws the concept map and the rung timeline lives in the Camera inspector. Consider surfacing the rung pips on the Camera card itself so the 2:25 beat needs no tab switch.
- Landing hero says "Learning should help you think" while the app's own copy says "the tutor that never gives you the answer". Pick one line and use it in both places.
