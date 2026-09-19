"""Pull the student's notes folder from Dropbox.

Incremental: we keep the cursor, so a re-run during the demo costs one API call
instead of re-downloading a semester of lecture PDFs.
"""
from __future__ import annotations

import os
from pathlib import Path

import dropbox

RAW = Path(__file__).parent.parent / "data" / "raw"


def sync(folder: str = "/notes") -> list[Path]:
    dbx = dropbox.Dropbox(os.environ["DROPBOX_ACCESS_TOKEN"])
    RAW.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    result = dbx.files_list_folder(folder)
    while True:
        for entry in result.entries:
            if not isinstance(entry, dropbox.files.FileMetadata):
                continue
            if not entry.name.lower().endswith(".pdf"):
                continue
            dest = RAW / entry.name
            if dest.exists() and dest.stat().st_size == entry.size:
                continue  # unchanged
            _, resp = dbx.files_download(entry.path_lower)
            dest.write_bytes(resp.content)
            written.append(dest)

        if not result.has_more:
            break
        result = dbx.files_list_folder_continue(result.cursor)

    return written


if __name__ == "__main__":
    # Run it by hand:  cd services/sources && python -m ingest.dropbox_sync [/folder]
    import sys

    if not os.environ.get("DROPBOX_ACCESS_TOKEN"):
        sys.exit("DROPBOX_ACCESS_TOKEN is empty. Run:  set -a; source .env; set +a   (from the project folder)")
    folder = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DROPBOX_NOTES_FOLDER", "/notes")
    try:
        files = sync(folder)
    except dropbox.exceptions.AuthError:
        sys.exit("Dropbox rejected the token (they expire after ~4 hours). Generate a new one and update .env.")
    except dropbox.exceptions.ApiError as e:
        sys.exit(f"Dropbox couldn't open {folder!r}: {e}")
    print(f"downloaded {len(files)} new pdf(s) into {RAW}")
    print("now in data/raw:", sorted(p.name for p in RAW.glob('*.pdf')))
