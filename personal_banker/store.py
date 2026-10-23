"""Local library of processed statements.

    library/
      <name>-<sha8>/
        meta.json              file name, hash, when added, page image info
        statement.pdf          the upload, byte for byte
        pages/001.png          rendered page images
        pages/001.json         layout + transcription (with token usage)
        pages/001.md           the page's transcription
        document.md            all pages, written once every page is transcribed
        budget.json            categorized expense / income / skipped rows, including the user's edits

The folder is configurable with PERSONAL_BANKER_LIBRARY and is git-ignored.
"""

import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .docai.pipeline import DocumentResult, PageResult
from .docai.render import PageImage
from .docai.schemas import PageLayout, PageTranscription
from .llm import CallResult

DEFAULT_ROOT = Path(os.environ.get("PERSONAL_BANKER_LIBRARY", "library"))
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg"}


@dataclass(frozen=True)
class StoredPage:
    file: str
    media_type: str
    width: int
    height: int


@dataclass(frozen=True)
class StoredDocument:
    id: str  # folder name
    name: str  # original file name
    sha256: str
    added: str  # ISO timestamp
    pages: tuple[StoredPage, ...]

    @property
    def page_count(self) -> int:
        return len(self.pages)


def _write(path: Path, data: str | bytes) -> None:
    """Write via a temporary file so a crash never leaves half a file behind."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data.encode("utf-8") if isinstance(data, str) else data)
    tmp.replace(path)


def _write_json(path: Path, value: Any) -> None:
    _write(path, json.dumps(value, indent=2, ensure_ascii=False))


def _dump_call(result: CallResult) -> dict:
    return {**asdict(result), "output": result.output.model_dump()}


def _load_call[T: BaseModel](data: dict, output_model: type[T]) -> CallResult[T]:
    return CallResult(**{**data, "output": output_model.model_validate(data["output"])})


def _slug(name: str) -> str:
    stem = Path(name).stem.lower()
    return re.sub(r"[^a-z0-9]+", "-", stem).strip("-")[:40] or "document"


class Library:
    def __init__(self, root: Path | str = DEFAULT_ROOT):
        self.root = Path(root)

    def _dir(self, doc: StoredDocument) -> Path:
        return self.root / doc.id

    # --- Documents -------------------------------------------------------------

    def documents(self) -> list[StoredDocument]:
        """Every stored document, newest first."""
        docs = [self._read_meta(meta) for meta in self.root.glob("*/meta.json")]
        return sorted(docs, key=lambda d: d.added, reverse=True)

    def get(self, doc_id: str) -> StoredDocument | None:
        meta = self.root / doc_id / "meta.json"
        return self._read_meta(meta) if meta.exists() else None

    def find(self, sha256: str) -> StoredDocument | None:
        return next((d for d in self.documents() if d.sha256 == sha256), None)

    def add(self, name: str, pdf_bytes: bytes, pages: list[PageImage]) -> StoredDocument:
        """Store an upload and its rendered pages; returns the existing entry if it is already stored."""
        sha256 = hashlib.sha256(pdf_bytes).hexdigest()
        if existing := self.find(sha256):
            return existing
        doc_id = f"{_slug(name)}-{sha256[:8]}"
        folder = self.root / doc_id
        stored_pages = []
        for page in pages:
            file = f"pages/{page.page_number:03d}.{EXTENSIONS[page.media_type]}"
            _write(folder / file, page.data)
            stored_pages.append(StoredPage(file, page.media_type, page.width, page.height))
        _write(folder / "statement.pdf", pdf_bytes)
        doc = StoredDocument(doc_id, name, sha256, datetime.now().isoformat(timespec="seconds"), tuple(stored_pages))
        # meta.json goes last: a folder without it is an interrupted add and is ignored.
        _write_json(folder / "meta.json", {**asdict(doc), "pages": [asdict(p) for p in stored_pages]})
        return doc

    def _read_meta(self, path: Path) -> StoredDocument:
        data = json.loads(path.read_text(encoding="utf-8"))
        return StoredDocument(**{**data, "pages": tuple(StoredPage(**p) for p in data["pages"])})

    # --- Pages -----------------------------------------------------------------

    def page_image(self, doc: StoredDocument, page_number: int) -> PageImage:
        page = doc.pages[page_number - 1]
        data = (self._dir(doc) / page.file).read_bytes()
        return PageImage(page_number, data, page.media_type, page.width, page.height)

    def page_images(self, doc: StoredDocument) -> list[PageImage]:
        return [self.page_image(doc, n) for n in range(1, doc.page_count + 1)]

    def save_page_result(self, doc: StoredDocument, result: PageResult) -> None:
        stem = self._dir(doc) / "pages" / f"{result.image.page_number:03d}"
        _write_json(
            stem.with_suffix(".json"),
            {"layout": _dump_call(result.layout), "transcription": _dump_call(result.transcription)},
        )
        _write(stem.with_suffix(".md"), result.markdown)
        results = self.page_results(doc)
        if len(results) == doc.page_count:
            _write(self._dir(doc) / "document.md", DocumentResult([results[n] for n in sorted(results)]).markdown)

    def page_results(self, doc: StoredDocument) -> dict[int, PageResult]:
        results: dict[int, PageResult] = {}
        for n in range(1, doc.page_count + 1):
            path = self._dir(doc) / "pages" / f"{n:03d}.json"
            if path.exists():
                data = json.loads(path.read_text(encoding="utf-8"))
                results[n] = PageResult(
                    self.page_image(doc, n),
                    _load_call(data["layout"], PageLayout),
                    _load_call(data["transcription"], PageTranscription),
                )
        return results

    def transcribed_pages(self, doc: StoredDocument) -> int:
        return sum((self._dir(doc) / "pages" / f"{n:03d}.json").exists() for n in range(1, doc.page_count + 1))

    def markdown(self, doc: StoredDocument) -> str | None:
        """The whole document's transcription, once every page is done."""
        path = self._dir(doc) / "document.md"
        return path.read_text(encoding="utf-8") if path.exists() else None

    # --- Budget rows -------------------------------------------------------------

    def save_budget(self, doc: StoredDocument, budget: dict) -> None:
        """`budget` holds 'expenses', 'income' and 'skipped' row lists plus provenance fields."""
        _write_json(self._dir(doc) / "budget.json", budget)

    def budget(self, doc: StoredDocument) -> dict | None:
        path = self._dir(doc) / "budget.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
