# 10-voloridge

Students need hints that leave the reasoning to them. The Voloridge benchmark
harness is designed to compare a plain GPT-4o response with LENS on 20 code cases,
checking whether either response reveals the fix. Its LENS call and corpus
validation still need repair, so there is no verified leakage score to quote.

**Lives in:** `apps/lens/scripts/bench.ts`, `apps/lens/fixtures/bugs.json`
