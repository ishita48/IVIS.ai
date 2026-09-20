# 04-dropbox

Students can bring their own course notes into a LENS session by selecting files
from the connected Dropbox folder in the Add source dialog. The import extracts
text from PDFs, documents, spreadsheets, and plain text, then sends it through
the source embedding and indexing pipeline. Content hashes let repeat imports
skip unchanged files and update changed notes in place.

**Lives in:** `apps/lens/lib/dropbox.ts`, `apps/lens/app/api/dropbox/ingest/route.ts`
