# Deploying LENS to Vercel

## Three things the dashboard has to be told

**1. Import the right repository.**
`ishita48/IVIS.ai` is a *fork* of `raoisha1/IVIS.ai`, and the fork is where
Vercel was pointed. Forks do not follow their upstream, so it was building a
commit from 09-19 17:43 — 115 commits behind, which predates the video
feature, the teacher dashboard, the reasoning pipeline and the cross-account
data-leak fix. Deploying it would ship that leak publicly.

Either import `raoisha1/IVIS.ai` directly, or open the fork on GitHub and
press **Sync fork** before every deploy. The first option is the one that
stops this recurring.

**2. Set Root Directory to `apps/lens`.**
There is no `package.json` at the repo root, which is exactly what
`No Next.js version detected` means. `apps/web` (Vite) and `services/*`
(FastAPI) are the earlier architecture and are not on the demo path — do not
deploy them.

**3. Add the environment variables.**
Every key in `apps/lens/.env.local` except the comments. `.env.local` is
gitignored and is not in the repo, so Vercel has none of them. The two
`NEXT_PUBLIC_*` values are read at build time, so a deploy started before
they exist bakes in the absence and has to be redeployed.

Required or the app will not boot: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`CLERK_SECRET_KEY`, `MONGODB_URI`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`ELASTIC_URL`, `ELASTIC_API_KEY`.

## Function duration and the Hobby plan

Hobby caps a serverless function at 60s and **rejects the build** above it,
so every route is pinned to 60. Next requires `maxDuration` to be a static
literal, so it cannot read the plan at build time — raising it means editing
the routes and `vercel.json` together.

What that costs on Hobby: video **motion** mode measured ~65s for three Sora
clips and scales with scene count, so it will time out. Narration-only and
generated stills finish inside 60s. On Pro the ceiling is 300s and motion
fits — raise `app/api/video/render` first.

## What will not work in production regardless of plan

- **MongoDB** is unreachable from here (`querySrv ECONNREFUSED`). Every path
  falls back to Elastic, which is the real datastore. If Atlas is paused,
  unpause it or leave it — nothing on the demo path needs it.
- **In-memory state does not survive across instances.** The Mongo circuit
  breaker (`lib/mongodb.ts`), the Google daily-image-cap latch
  (`lib/imagegen.ts`) and the demo-token rate limits (`lib/demo-access.ts`)
  are per-instance. They degrade to being less effective, not to being
  wrong: each cold instance simply re-learns.
- **ElevenLabs is out of characters** (39,997/40,000). The voice tutor cannot
  speak until the plan resets or is upgraded.
- **Cloudinary's cloud name is wrong.** `npm run cloudinary:check` names the
  field. Only the downloadable MP4 depends on it.
- **Resend has no verified domain**, so invites only reach the address that
  owns the Resend account. The join link works for everyone.
