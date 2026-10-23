"""Processing a stored statement end to end: extract every page, then categorize it.

Shared by the Streamlit document viewer and the API, which differ only in how
they report progress.
"""

import os
from collections.abc import Callable
from concurrent.futures import as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import anthropic
import braintrust
from braintrust import TracedThreadPoolExecutor

from .categorize import DEFAULT_WORKBOOK, BudgetSetup, RulesError, budget_record, categorize_statement, load_budget_setup
from .docai import paddle
from .docai.pipeline import Engine, engine_concurrency, extract_page
from .llm import ExtractionError
from .store import Library, StoredDocument


class CategorizeSkipped(Exception):
    """The statement can't be categorized here: no API key, no workbook, or a workbook problem."""


@dataclass(frozen=True)
class Outcome:
    kind: Literal["success", "warning", "error"]
    message: str
    failed_pages: int


def has_api_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def engine_problem(engine: Engine) -> str | None:
    """Why `engine` can't run in this environment, or None when it can."""
    if engine == "paddleocr-vl" and not paddle.is_available():
        return "PaddleOCR-VL isn't installed. Install it with `uv sync --extra paddle` and restart."
    if engine == "claude" and not has_api_key():
        return "Reading statements with Claude needs ANTHROPIC_API_KEY."
    return None


def budget_workbook() -> tuple[bytes, str] | None:
    """The budget workbook at DEFAULT_WORKBOOK as (bytes, name), or None if it is missing."""
    path = Path(DEFAULT_WORKBOOK)
    return (path.read_bytes(), path.name) if path.exists() else None


def workbook_setup(load: Callable[[bytes], BudgetSetup] = load_budget_setup) -> tuple[BudgetSetup, str]:
    """The categories, past entries and vendor rules to categorize with, and the workbook's name.

    `load` reads the workbook bytes; the Streamlit app passes its cached loader.
    """
    if (found := budget_workbook()) is None:
        raise CategorizeSkipped(f"No budget workbook found at {DEFAULT_WORKBOOK}.")
    workbook, name = found
    try:
        return load(workbook), name
    except RulesError as e:
        raise CategorizeSkipped(f"Problem with the Vendor Rules tab: {e}") from e
    except (KeyError, StopIteration) as e:
        raise CategorizeSkipped(f"Couldn't read the budget workbook: {e}") from e


def extract_pages(
    library: Library,
    doc: StoredDocument,
    engine: Engine,
    client: anthropic.Anthropic | None,
    pages: list[int],
    on_page: Callable[[int, Exception | None], None] = lambda *_: None,
) -> int:
    """Extract `pages` with `engine`, saving each one as it finishes; returns how many failed.

    `on_page(page_number, error)` runs in the calling thread after each page, with error None on success.
    """
    failed = 0
    with braintrust.start_span(name="extract_pages", metadata={"engine": engine, "pages": len(pages)}) as span:
        # The traced pool carries this span into the workers, so each page nests under it.
        with TracedThreadPoolExecutor(max_workers=engine_concurrency(engine)) as pool:
            futures = {pool.submit(extract_page, engine, client, library.page_image(doc, n)): n for n in pages}
            for future in as_completed(futures):
                error = None
                try:
                    library.save_page_result(doc, future.result(), engine)
                except (ExtractionError, anthropic.APIError) as e:
                    error = e
                    failed += 1
                on_page(futures[future], error)
        span.log(metrics={"failed_pages": failed})
    return failed


def categorize_document(
    library: Library,
    doc: StoredDocument,
    engine: Engine,
    client: anthropic.Anthropic | None,
    load: Callable[[bytes], BudgetSetup] = load_budget_setup,
) -> StoredDocument:
    """Add a fully transcribed statement to the budget.

    Returns the document as stored afterwards: renamed after its statement period.
    """
    if client is None:
        raise CategorizeSkipped("Categorizing uses Claude, and no Anthropic API key is set.")
    setup, workbook_name = workbook_setup(load)
    return library.save_budget(
        doc, budget_record(categorize_statement(client, library.markdown(doc, engine), setup), workbook_name)
    )


def process_document(
    library: Library,
    doc: StoredDocument,
    engine: Engine,
    client: anthropic.Anthropic | None,
    on_page: Callable[[int, Exception | None], None] = lambda *_: None,
    on_categorize: Callable[[], None] = lambda: None,
    load: Callable[[bytes], BudgetSetup] = load_budget_setup,
) -> Outcome:
    """Extract the pages not yet transcribed, then categorize the statement unless it already is.

    Call it inside the statement's trace; extraction and categorization add their spans under it.
    """
    failed = 0
    if todo := library.untranscribed_pages(doc, engine):
        failed = extract_pages(library, doc, engine, client, todo, on_page)

    if library.markdown(doc, engine) is None:
        return Outcome("error", "Some pages failed, so the statement wasn't added to your budget. Run the analysis again.", failed)
    if library.budget(doc) is not None:
        return Outcome("success", "Extraction finished. This statement was already in your budget categories.", failed)

    on_categorize()
    try:
        saved = categorize_document(library, doc, engine, client, load)
    except CategorizeSkipped as e:
        return Outcome("warning", f"Extracted, but not categorized. {e}", failed)
    except (ExtractionError, anthropic.APIError) as e:
        return Outcome("warning", f"Extracted, but categorizing failed: {e}", failed)
    renamed = f" Saved as {saved.name}." if saved.name != doc.name else ""
    return Outcome("success", f"Extracted and added to your budget categories.{renamed}", failed)
