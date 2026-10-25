"""One user's statement files: the uploads and everything read from them.

    <user folder>/statements/        (see datastore.py for the rest of the user's folder)
      <name>-<sha8>/
        meta.json              display name (renamed to the statement period once categorized),
                               original file name, hash, when added, page image info
        statement.pdf          the upload, byte for byte
        pages/001.png          rendered page images
        pages/001.json         layout + transcription (with token usage)
        pages/001.md           the page's transcription
        document.md            all pages, written once every page is transcribed
        paddleocr-vl/          the same results from the local PaddleOCR-VL engine:
          001.json, 001.md, document.md
        budget.json            the categorizer's expense / income / skipped rows (Streamlit edits them);
                               the app's ledger is imported from it (ledger.import_statement)

The app's state for a statement (processing status, account, period) and its
transactions are records in the user's DataStore, not files here.

StatementFiles is what callers use; SurrealLibrary (surreal.py) keeps the same files in SurrealDB.
"""

import hashlib
import json
import os
import re
import threading
import time
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol, get_args

from pydantic import BaseModel

from .docai.pipeline import EXTRACTION_ENGINE, DocumentResult, Engine, PageResult
from .docai.render import PageImage
from .docai.schemas import PageLayout, PageTranscription
from .llm import CallResult

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
    name: str  # display name: the upload's file name until categorizing renames it after its period
    sha256: str
    added: str  # ISO timestamp
    pages: tuple[StoredPage, ...]
    original_name: str | None = None  # the upload's file name, once the document has been renamed

    @property
    def page_count(self) -> int:
        return len(self.pages)


_write_lock = threading.Lock()


def write_file(path: Path, data: str | bytes) -> None:
    """Write via a temporary file so a crash never leaves half a file behind.

    Requests run in threads, and several may write the same file at once (a user's first requests all
    create user.json). Windows refuses to replace a file another thread is replacing or reading, so
    writers take turns, each with its own temporary file, and a replace a reader blocks is retried.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}-{threading.get_ident()}.tmp")
    tmp.write_bytes(data.encode("utf-8") if isinstance(data, str) else data)
    with _write_lock:
        for attempt in range(20):
            try:
                tmp.replace(path)
                return
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.05)


def _write_json(path: Path, value: Any) -> None:
    write_file(path, json.dumps(value, indent=2, ensure_ascii=False))


def _dump_call(result: CallResult) -> dict:
    return {**asdict(result), "output": result.output.model_dump()}


def _load_call[T: BaseModel](data: dict, output_model: type[T]) -> CallResult[T]:
    return CallResult(**{**data, "output": output_model.model_validate(data["output"])})


def _slug(name: str) -> str:
    stem = Path(name).stem.lower()
    return re.sub(r"[^a-z0-9]+", "-", stem).strip("-")[:40] or "document"


def document_id(name: str, sha256: str) -> str:
    return f"{_slug(name)}-{sha256[:8]}"


class StatementFiles(Protocol):
    """One user's statement files (Library on disk, SurrealLibrary in SurrealDB)."""

    location: str  # where they are, for messages

    def documents(self) -> list[StoredDocument]:
        """Every stored document, newest first."""
        ...
    def get(self, doc_id: str) -> StoredDocument | None: ...
    def find(self, sha256: str) -> StoredDocument | None: ...
    def add(self, name: str, pdf_bytes: bytes, pages: list[PageImage]) -> StoredDocument:
        """Store an upload and its rendered pages; returns the existing entry if it is already stored."""
        ...
    def rename(self, doc: StoredDocument, name: str) -> StoredDocument: ...
    def page_image(self, doc: StoredDocument, page_number: int) -> PageImage: ...
    def page_images(self, doc: StoredDocument) -> list[PageImage]: ...
    def save_page_result(self, doc: StoredDocument, result: PageResult, engine: Engine = EXTRACTION_ENGINE) -> None: ...
    def page_results(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> dict[int, PageResult]: ...
    def transcribed_pages(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> int: ...
    def untranscribed_pages(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> list[int]: ...
    def markdown(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> str | None:
        """The whole document's transcription from `engine`, once every page is done."""
        ...
    def save_budget(self, doc: StoredDocument, budget: dict) -> StoredDocument: ...
    def budget(self, doc: StoredDocument) -> dict | None: ...

    # Copying as stored, for copy_document; any part may be missing (e.g. an interrupted upload).
    def pdf(self, doc: StoredDocument) -> bytes | None: ...
    def page_data(self, doc: StoredDocument, page_number: int) -> bytes | None: ...
    def stored_results(self, doc: StoredDocument, engine: Engine) -> dict[int, dict]:
        """Each transcribed page's saved result (layout and transcription calls) and its "markdown"."""
        ...
    def put(self, doc: StoredDocument, pdf_bytes: bytes | None, pages: dict[int, bytes]) -> None:
        """Stores the document as given (id, name and date included) with the page images there are."""
        ...
    def put_results(self, doc: StoredDocument, engine: Engine, results: dict[int, dict], markdown: str | None) -> None:
        """Stores saved page results (as stored_results gives them) and the whole transcription, if done."""
        ...


def copy_document(source: StatementFiles, target: StatementFiles, doc: StoredDocument) -> None:
    """Copies the document and everything read from it as stored, keeping its id."""
    pages = {n: data for n in range(1, doc.page_count + 1) if (data := source.page_data(doc, n)) is not None}
    target.put(doc, source.pdf(doc), pages)
    for engine in get_args(Engine):
        if results := source.stored_results(doc, engine):
            target.put_results(doc, engine, results, source.markdown(doc, engine))
    if (budget := source.budget(doc)) is not None:
        target.save_budget(doc, budget)


class Library:
    """StatementFiles in a folder."""

    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.location = str(self.root)

    def _dir(self, doc: StoredDocument) -> Path:
        return self.root / doc.id

    def _results_dir(self, doc: StoredDocument, engine: Engine) -> Path:
        # Claude's results stay in pages/ next to the images, where they were before engines existed.
        return self._dir(doc) / ("pages" if engine == "claude" else engine)

    def _document_md(self, doc: StoredDocument, engine: Engine) -> Path:
        folder = self._dir(doc) if engine == "claude" else self._results_dir(doc, engine)
        return folder / "document.md"

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
        stored_pages = tuple(
            StoredPage(f"pages/{p.page_number:03d}.{EXTENSIONS[p.media_type]}", p.media_type, p.width, p.height) for p in pages
        )
        doc = StoredDocument(document_id(name, sha256), name, sha256, datetime.now().isoformat(timespec="seconds"), stored_pages)
        self.put(doc, pdf_bytes, {p.page_number: p.data for p in pages})
        return doc

    def put(self, doc: StoredDocument, pdf_bytes: bytes | None, pages: dict[int, bytes]) -> None:
        folder = self._dir(doc)
        for n, data in pages.items():
            write_file(folder / doc.pages[n - 1].file, data)
        if pdf_bytes is not None:
            write_file(folder / "statement.pdf", pdf_bytes)
        # meta.json goes last: a folder without it is an interrupted add and is ignored.
        self._write_meta(doc)

    def pdf(self, doc: StoredDocument) -> bytes | None:
        path = self._dir(doc) / "statement.pdf"
        return path.read_bytes() if path.exists() else None

    def page_data(self, doc: StoredDocument, page_number: int) -> bytes | None:
        path = self._dir(doc) / doc.pages[page_number - 1].file
        return path.read_bytes() if path.exists() else None

    def stored_results(self, doc: StoredDocument, engine: Engine) -> dict[int, dict]:
        results = {}
        for n in range(1, doc.page_count + 1):
            stem = self._results_dir(doc, engine) / f"{n:03d}"
            if stem.with_suffix(".json").exists():
                md = stem.with_suffix(".md")
                results[n] = {
                    **json.loads(stem.with_suffix(".json").read_text(encoding="utf-8")),
                    "markdown": md.read_text(encoding="utf-8") if md.exists() else None,
                }
        return results

    def put_results(self, doc: StoredDocument, engine: Engine, results: dict[int, dict], markdown: str | None) -> None:
        for n, result in results.items():
            stem = self._results_dir(doc, engine) / f"{n:03d}"
            _write_json(stem.with_suffix(".json"), {k: v for k, v in result.items() if k != "markdown"})
            if result.get("markdown") is not None:
                write_file(stem.with_suffix(".md"), result["markdown"])
        if markdown is not None:
            write_file(self._document_md(doc, engine), markdown)

    def rename(self, doc: StoredDocument, name: str) -> StoredDocument:
        """Show the document as `name`. The folder keeps its id; the upload's name is kept as original_name."""
        if name == doc.name:
            return doc
        renamed = replace(doc, name=name, original_name=doc.original_name or doc.name)
        self._write_meta(renamed)
        return renamed

    def _write_meta(self, doc: StoredDocument) -> None:
        _write_json(self._dir(doc) / "meta.json", {**asdict(doc), "pages": [asdict(p) for p in doc.pages]})

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

    def save_page_result(self, doc: StoredDocument, result: PageResult, engine: Engine = EXTRACTION_ENGINE) -> None:
        stem = self._results_dir(doc, engine) / f"{result.image.page_number:03d}"
        _write_json(
            stem.with_suffix(".json"),
            {"layout": _dump_call(result.layout), "transcription": _dump_call(result.transcription)},
        )
        write_file(stem.with_suffix(".md"), result.markdown)
        results = self.page_results(doc, engine)
        if len(results) == doc.page_count:
            write_file(self._document_md(doc, engine), DocumentResult([results[n] for n in sorted(results)]).markdown)

    def page_results(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> dict[int, PageResult]:
        results: dict[int, PageResult] = {}
        for n in range(1, doc.page_count + 1):
            path = self._results_dir(doc, engine) / f"{n:03d}.json"
            if path.exists():
                data = json.loads(path.read_text(encoding="utf-8"))
                results[n] = PageResult(
                    self.page_image(doc, n),
                    _load_call(data["layout"], PageLayout),
                    _load_call(data["transcription"], PageTranscription),
                )
        return results

    def transcribed_pages(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> int:
        return doc.page_count - len(self.untranscribed_pages(doc, engine))

    def untranscribed_pages(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> list[int]:
        folder = self._results_dir(doc, engine)
        return [n for n in range(1, doc.page_count + 1) if not (folder / f"{n:03d}.json").exists()]

    def markdown(self, doc: StoredDocument, engine: Engine = EXTRACTION_ENGINE) -> str | None:
        """The whole document's transcription from `engine`, once every page is done."""
        path = self._document_md(doc, engine)
        return path.read_text(encoding="utf-8") if path.exists() else None

    # --- Budget rows -------------------------------------------------------------

    def save_budget(self, doc: StoredDocument, budget: dict) -> StoredDocument:
        """`budget` holds 'expenses', 'income' and 'skipped' row lists plus provenance fields.

        When it has a 'title' (the statement's period and account), the document is
        renamed to it; returns the document as now stored.
        """
        _write_json(self._dir(doc) / "budget.json", budget)
        return self.rename(doc, f"{title}.pdf") if (title := budget.get("title")) else doc

    def budget(self, doc: StoredDocument) -> dict | None:
        path = self._dir(doc) / "budget.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
