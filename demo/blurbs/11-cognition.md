# 11-cognition

Devin ran overnight while the team slept, one brief per branch, and a human merged or closed each PR at 8am. Seventeen Devin PRs opened (#2–#16, #21, #23), 13 merged, 4 closed for scope; four of the merges came in round 3 through `integration/round3`. It found the broken `analyze` import in `apps/lens` (PR #8) before any human had. It also introduced one defect — PR #12 pulled the Mongo driver into the client bundle — which a human fixed in `34934cb` and `apps/lens/lib/server-boundary.test.ts` now guards.

**Lives in:** PR history, `docs/devin-log.md`, `docs/devin-briefs.md`, `apps/lens/lib/server-boundary.test.ts`
