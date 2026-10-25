"""Processing a stored statement end to end: extract every page, then categorize it into the ledger.

Shared by the Streamlit document viewer and the API, which differ only in how
they report progress. Categorizing follows the user's budget workbook when there
is one (PERSONAL_BANKER_WORKBOOK); without it, the app's own categories.
"""

import os
from collections.abc import Callable
from concurrent.futures import as_completed
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Literal, get_args

import anthropic
import braintrust
from braintrust import TracedThreadPoolExecutor

from . import ledger
from .categorize import (
    DEFAULT_WORKBOOK,
    BudgetSetup,
    Category,
    PastEntry,
    RulesError,
    account_record,
    budget_record,
    categorize_statement,
    identify_account,
    load_budget_setup,
    read_summary,
    summary_record,
)
from .docai import paddle
from .docai.pipeline import EXTRACTION_ENGINE, Engine, engine_concurrency, extract_page
from .datastore import DataStore
from .llm import ExtractionError
from .records import INCOME_CATEGORIES
from .store import StoredDocument


class CategorizeSkipped(Exception):
    """The statement can't be categorized here: no API key, or a problem with the workbook."""


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


# What each app category holds, for the categorizer when there is no workbook (see the assistant's prompt too).
APP_CATEGORY_NOTES: dict[str, str] = {
    "Groceries": "supermarkets and grocery stores",
    "Food": "restaurants, cafés, bars, takeout and food delivery",
    "Gas & EV charging": "fuel and EV charging stations",
    "Transport": "transit, taxis, rideshare, flights and other travel",
    "Car": "the user's car: insurance, financing or lease payments, maintenance, parking and tolls",
    "Shopping": "clothing, electronics, household goods, gifts and online shopping",
    "Health": "pharmacy, medical, dental and gym",
    "Entertainment": "movies, events, games and hobbies",
    "Subscriptions": "streaming, software and other recurring memberships",
    "Phone & Internet": "mobile, internet and cable bills",
    "Utilities": "electricity, water and heating",
    "Housing": "rent, mortgage, condo fees and home maintenance",
    "Fees & interest": "bank and card fees and interest charged",
    "Other": "anything that fits nowhere else",
    "Work": "pay from an employer",
    "Tax refund": "tax refunds and government benefits",
    "Side income": "freelance, rental and other side income",
    "Reimbursement": "money paid back by an employer or friends",
    "Other income": "interest earned and any other money received",
}
# Past transactions shown to the categorizer as examples of how the user names and sorts things.
APP_EXAMPLES = 200


def app_budget_setup(store: DataStore) -> BudgetSetup:
    """Categorize with the app's own categories when there is no workbook; the user's ledger so far gives the examples."""
    txs = [t for t in ledger.transactions(store) if t.source == "statement"][:APP_EXAMPLES]

    def entries(income: bool) -> list[PastEntry]:
        return [
            PastEntry(date.fromisoformat(t.date), t.merchant, t.amount, t.category, None)
            for t in txs
            if t.is_income == income and (t.category in INCOME_CATEGORIES) == income
        ]

    return BudgetSetup(
        expense_categories=[Category(c, APP_CATEGORY_NOTES.get(c)) for c in ledger.APP_CATEGORIES if c not in INCOME_CATEGORIES],
        income_categories=[Category(c, APP_CATEGORY_NOTES.get(c)) for c in INCOME_CATEGORIES],
        past_expenses=entries(False),
        past_income=entries(True),
    )


def workbook_setup(store: DataStore, load: Callable[[bytes], BudgetSetup] = load_budget_setup) -> tuple[BudgetSetup, str]:
    """The categories, past entries and vendor rules to categorize with, and where they came from.

    From the budget workbook at DEFAULT_WORKBOOK when it exists, else the app's own categories.
    `load` reads the workbook bytes; the Streamlit app passes its cached loader.
    """
    if (found := budget_workbook()) is None:
        return app_budget_setup(store), "app categories"
    workbook, name = found
    try:
        return load(workbook), name
    except RulesError as e:
        raise CategorizeSkipped(f"Problem with the Vendor Rules tab: {e}") from e
    except (KeyError, StopIteration) as e:
        raise CategorizeSkipped(f"Couldn't read the budget workbook: {e}") from e


def extract_pages(
    store: DataStore,
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
            futures = {pool.submit(extract_page, engine, client, store.files.page_image(doc, n)): n for n in pages}
            for future in as_completed(futures):
                error = None
                try:
                    store.files.save_page_result(doc, future.result(), engine)
                except (ExtractionError, anthropic.APIError) as e:
                    error = e
                    failed += 1
                on_page(futures[future], error)
        span.log(metrics={"failed_pages": failed})
    return failed


def save_categorized(store: DataStore, doc: StoredDocument, budget: dict) -> StoredDocument:
    """Keeps the categorizer's rows with the statement and puts them in the ledger; returns the document renamed after its period."""
    saved = store.files.save_budget(doc, budget)
    ledger.import_statement(store, doc.id, budget)
    return saved


def categorize_document(
    store: DataStore,
    doc: StoredDocument,
    engine: Engine,
    client: anthropic.Anthropic | None,
    load: Callable[[bytes], BudgetSetup] = load_budget_setup,
) -> StoredDocument:
    """Add a fully transcribed statement to the ledger.

    Returns the document as stored afterwards: renamed after its statement period.
    """
    if client is None:
        raise CategorizeSkipped("Categorizing uses Claude, and no Anthropic API key is set.")
    setup, setup_name = workbook_setup(store, load)
    result = categorize_statement(client, store.files.markdown(doc, engine), setup)
    return save_categorized(store, doc, budget_record(result, setup_name))


def needs_account(store: DataStore, doc_id: str) -> bool:
    """Categorized before the statement's account was recorded."""
    return (s := store.statement(doc_id)) is not None and s.categorized and s.account is None


def needs_summary(store: DataStore, doc_id: str) -> bool:
    """Categorized before the statement's period and rewards summary were kept.

    Bank account statements are left out: they don't print rewards, and nothing needs their period yet.
    """
    s = store.statement(doc_id)
    return s is not None and s.categorized and not s.summary_read and (s.account or {}).get("type") != "bank_account"


def _any_markdown(store: DataStore, doc: StoredDocument) -> str | None:
    """The statement's complete transcription, preferring the current engine's."""
    engines = [EXTRACTION_ENGINE, *(e for e in get_args(Engine) if e != EXTRACTION_ENGINE)]
    return next((md for e in engines if (md := store.files.markdown(doc, e)) is not None), None)


def identify_statement_account(store: DataStore, doc: StoredDocument, client: anthropic.Anthropic) -> bool:
    """Fills in which account a categorized statement is for, from its saved transcription (no re-categorizing).

    False when there is no complete transcription to read it from.
    """
    if (markdown := _any_markdown(store, doc)) is None:
        return False
    store.update_statement(doc.id, account=account_record(identify_account(client, markdown).output))
    return True


def read_statement_summary(store: DataStore, doc: StoredDocument, client: anthropic.Anthropic) -> bool:
    """Fills in a categorized statement's period and rewards summary, from its saved transcription.

    False when there is no complete transcription to read them from.
    """
    if (markdown := _any_markdown(store, doc)) is None:
        return False
    summary = summary_record(read_summary(client, markdown).output)
    store.update_statement(
        doc.id,
        summary_read=True,
        period_start=summary["period"]["start"],
        period_end=summary["period"]["end"],
        rewards=summary["rewards"],
    )
    return True


def process_document(
    store: DataStore,
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
    if todo := store.files.untranscribed_pages(doc, engine):
        failed = extract_pages(store, doc, engine, client, todo, on_page)

    if store.files.markdown(doc, engine) is None:
        return Outcome("error", "Some pages failed, so the statement wasn't added to your budget. Run the analysis again.", failed)
    if (budget := store.files.budget(doc)) is not None:
        if not ((s := store.statement(doc.id)) and s.categorized):
            ledger.import_statement(store, doc.id, budget)
        return Outcome("success", "Extraction finished. This statement was already in your budget categories.", failed)

    on_categorize()
    try:
        saved = categorize_document(store, doc, engine, client, load)
    except CategorizeSkipped as e:
        return Outcome("warning", f"Extracted, but not categorized. {e}", failed)
    except (ExtractionError, anthropic.APIError) as e:
        return Outcome("warning", f"Extracted, but categorizing failed: {e}", failed)
    renamed = f" Saved as {saved.name}." if saved.name != doc.name else ""
    return Outcome("success", f"Extracted and added to your budget categories.{renamed}", failed)
