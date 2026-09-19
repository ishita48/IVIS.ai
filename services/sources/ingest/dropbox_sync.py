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
