# 03-elastic-search

Students can search their uploaded notes using different wording from the
original passage. Elastic stores chunks of up to 1,800 characters and combines
keyword and vector rankings, returning source titles and passage text filtered
to the student's account.

**Lives in:** `apps/lens/lib/elastic.ts`, `apps/lens/app/api/search/vector/route.ts`
