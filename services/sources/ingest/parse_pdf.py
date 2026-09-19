"""PDF -> per-page text, with char offsets preserved.

Offsets matter: the source card highlights the exact sentence, and a deep link
with a page anchor is the difference between 'trust me' and 'look'.
"""
from __future__ import annotations

import json
from pathlib import Path

from pypdf import PdfReader

PARSED = Path(__file__).parent.parent / "data" / "parsed"


def parse(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").replace("\x00", "")
        pages.append({"page": i, "text": text})

    doc = {"doc_id": pdf_path.stem, "title": pdf_path.name, "pages": pages}
    PARSED.mkdir(parents=True, exist_ok=True)
    (PARSED / f"{pdf_path.stem}.json").write_text(json.dumps(doc))
    return doc
