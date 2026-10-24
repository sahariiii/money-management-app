"""Local library of processed statements.

    library/
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
        budget.json           categorized expense / income / skipped rows, including the user's edits
      merchant_rules.json      merchant -> app category, from "always categorize" in the mobile app
      cards.json               the mobile app's cards and their reward rules (last 4 digits only)
      receipts.json            expenses added from scanned receipts in the mobile app
      receipts/<scan id>.jpg   a scanned receipt's photo (upright, at most 1568 px)
      receipts/<scan id>.json  what was read from it, and the transaction it belongs to

The folder is configurable with PERSONAL_BANKER_LIBRARY and is git-ignored.
"""

import hashlib
import json
import os
import re
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .docai.pipeline import EXTRACTION_ENGINE, DocumentResult, Engine, PageResult
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
    name: str  # display name: the upload's file name until categorizing renames it after its period
    sha256: str
    added: str  # ISO timestamp
    pages: tuple[StoredPage, ...]
    original_name: str | None = None  # the upload's file name, once the document has been renamed

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
        self._write_meta(doc)
        return doc

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
        _write(stem.with_suffix(".md"), result.markdown)
        results = self.page_results(doc, engine)
        if len(results) == doc.page_count:
            _write(self._document_md(doc, engine), DocumentResult([results[n] for n in sorted(results)]).markdown)

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

    # --- App merchant rules --------------------------------------------------------

    def merchant_rules(self) -> dict[str, str]:
        """Merchant name -> app category; the app applies these to every statement, including future ones."""
        path = self.root / "merchant_rules.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def save_merchant_rules(self, rules: dict[str, str]) -> None:
        _write_json(self.root / "merchant_rules.json", rules)

    # --- App cards -------------------------------------------------------------------

    def cards(self) -> dict:
        """The app's cards and their reward rules: {"cards": [...], "reward_rules": [...]} (see ledger.py)."""
        path = self.root / "cards.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"cards": [], "reward_rules": []}

    def save_cards(self, data: dict) -> None:
        _write_json(self.root / "cards.json", data)

    # --- Expenses added from receipts ---------------------------------------------------

    def receipt_expenses(self) -> list[dict]:
        """Expenses the user added from scanned receipts (see ledger.py); the photos aren't kept."""
        path = self.root / "receipts.json"
        return json.loads(path.read_text(encoding="utf-8"))["expenses"] if path.exists() else []

    def save_receipt_expenses(self, expenses: list[dict]) -> None:
        _write_json(self.root / "receipts.json", {"expenses": expenses})

    # --- Scanned receipts (photo + what was read from it) -----------------------------
    # Ids are checked by the caller (ledger.is_scan_id) before they reach a path.

    def scans(self) -> list[dict]:
        folder = self.root / "receipts"
        return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(folder.glob("*.json"))] if folder.exists() else []

    def scan(self, scan_id: str) -> dict | None:
        path = self.root / "receipts" / f"{scan_id}.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def scan_image(self, scan_id: str) -> bytes | None:
        path = self.root / "receipts" / f"{scan_id}.jpg"
        return path.read_bytes() if path.exists() else None

    def save_scan(self, scan: dict, image_jpeg: bytes | None = None) -> None:
        if image_jpeg is not None:
            _write(self.root / "receipts" / f"{scan['id']}.jpg", image_jpeg)
        _write_json(self.root / "receipts" / f"{scan['id']}.json", scan)

    def delete_scan(self, scan_id: str) -> None:
        for suffix in (".json", ".jpg"):
            (self.root / "receipts" / f"{scan_id}{suffix}").unlink(missing_ok=True)
