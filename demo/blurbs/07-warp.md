# 07-warp

`npm run boundary` runs `scripts/boundary-check.ts`. It starts at every `"use client"` file, walks value imports, and exits 1 with the chain when the walk reaches the Mongo driver or a server secret. It exists because of PR #12, where a client hook reached `lib/pointer.ts → lib/token-ledger.ts → lib/events.ts → mongodb` and Next crashed on `child_process` — found after merge, guard written the same night.

The LENS Guide extension in `apps/lens/extension/` and `apps/lens/app/api/guide/step` screenshots the tab each turn and walks a developer through an unfamiliar console such as Atlas, Vercel, or Clerk one step at a time.

The Warp workflows in `infra/warp/lens.yaml` cover dev, db setup, elastic up, boundary, test, and demo token.

**Lives in:** `apps/lens/scripts/boundary-check.ts`, `apps/lens/lib/server-boundary.test.ts`, `apps/lens/extension/`, `infra/warp/lens.yaml`
