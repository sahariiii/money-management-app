"""HTTP API for the Expo app in the repository root.

    cd backend
    uv run uvicorn personal_banker.api:app --host 0.0.0.0 --port 8000

--host 0.0.0.0 lets a phone on the same Wi-Fi reach it (allow port 8000
through Windows Firewall). Every /api request sends a bearer token: the app's
Clerk session token, or PERSONAL_BANKER_API_TOKEN from scripts (see auth.py).

It serves the same library as the Streamlit app, so both can run at once; just
don't process statements in both at the same time, as PaddleOCR-VL needs the
whole GPU. Response models mirror src/types.ts.
"""

import hashlib
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import auth, ledger
from .docai import render_pdf
from .docai.pipeline import EXTRACTION_ENGINE
from .ledger import AppCategory, AppModel, Card, CategoryUpdate, Transaction
from .llm import make_client, start_trace
from .pipeline import MAX_BYTES, PasswordRequired, StatementError, prepare_pdf
from .service import engine_problem, has_api_key, process_document
from .store import Library, StoredDocument

log =logging.getLogger("uvicorn.error")
library = Library()


# ---------------------------------------------------------------------------
# Statement processing in the background


class Statement(AppModel):
    id: str
    name: str
    uploaded_at: str
    page_count: int
    pages_done: int
    status: Literal["processing", "done", "incomplete"]
    message: str | None  # what is happening now, or why it stopped short
    transaction_count: int | None


# One statement at a time: PaddleOCR-VL has one GPU, and Claude already reads pages in parallel.
_jobs = ThreadPoolExecutor(max_workers=1, thread_name_prefix="statement")
_job_lock = threading.Lock()
_running: dict[str, str] = {}  # document id -> current stage, while queued or running
_stopped: dict[str, str] = {}  # document id -> why its last run stopped short


def _statement(doc: StoredDocument) -> Statement:
    budget = library.budget(doc)
    with _job_lock:
        stage, reason = _running.get(doc.id), _stopped.get(doc.id)
    if stage is not None:
        status, message = "processing", stage
    elif budget is not None:
        status, message = "done", None
    else:
        status, message = "incomplete", reason or "Not processed yet."
    return Statement(
        id=doc.id,
        name=doc.name,
        uploaded_at=doc.added,
        page_count=doc.page_count,
        pages_done=library.transcribed_pages(doc, EXTRACTION_ENGINE),
        status=status,
        message=message,
        transaction_count=len(budget["expenses"]) + len(budget["income"]) if budget else None,
    )


def _set_stage(doc_id: str, stage: str) -> None:
    with _job_lock:
        _running[doc_id] = stage


def _queue(doc: StoredDocument) -> None:
    """Start processing the statement unless it is already categorized or queued."""
    with _job_lock:
        if doc.id in _running or library.budget(doc) is not None:
            return
        _running[doc.id] = "Waiting for another statement to finish."
        _stopped.pop(doc.id, None)
    _jobs.submit(_process, doc.id)


def _process(doc_id: str) -> None:
    doc = library.get(doc_id)
    reason = None
    try:
        if problem := engine_problem(EXTRACTION_ENGINE):
            reason = problem
        else:
            _set_stage(doc_id, "Reading the pages.")
            trace = start_trace("statement", input={"file": doc.name, "source": "api"})
            with trace:
                trace.log(metadata={"doc_id": doc.id, "engine": EXTRACTION_ENGINE, "pages": doc.page_count})
                outcome = process_document(
                    library,
                    doc,
                    EXTRACTION_ENGINE,
                    make_client() if has_api_key() else None,
                    on_categorize=lambda: _set_stage(doc_id, "Sorting the transactions into categories."),
                )
                trace.log(
                    output={"result": outcome.kind, "message": outcome.message},
                    metrics={"failed_pages": outcome.failed_pages},
                )
            if outcome.kind != "success":
                reason = outcome.message
    except Exception as e:  # report it on the statement rather than losing it in the worker thread
        log.exception("Processing %s failed", doc_id)
        reason = f"Processing failed: {e}"
    with _job_lock:
        _running.pop(doc_id, None)
        if reason:
            _stopped[doc_id] = reason


# ---------------------------------------------------------------------------
# App


_bearer = HTTPBearer(auto_error=False)


def require_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> str:
    """The caller, from the bearer token (see auth.py)."""
    try:
        return auth.authorize(credentials.credentials if credentials else None)
    except auth.AuthError as e:
        raise HTTPException(e.status, str(e), headers={"WWW-Authenticate": "Bearer"}) from e


@asynccontextmanager
async def lifespan(_: FastAPI):
    if auth.is_open():
        log.warning(
            "Neither %s nor %s is set: anyone who can reach this server can read your statements.",
            auth.CLERK_KEY_ENV,
            auth.TOKEN_ENV,
        )
    elif os.environ.get(auth.CLERK_KEY_ENV) and not os.environ.get(auth.ALLOWED_USERS_ENV):
        log.warning("%s isn't set: anyone who can sign in to the app can read your statements.", auth.ALLOWED_USERS_ENV)
    yield
    _jobs.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="Personal Banker", lifespan=lifespan)
# Browsers may only call it from the Expo web app on this computer; the phone app isn't subject to CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)
api = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


@app.get("/api/health")
def health() -> dict:
    """Unauthenticated, so the app can tell "server down" from "wrong token"."""
    return {"ok": True}


@api.get("/cards")
def get_cards() -> list[Card]:
    return [ledger.DUMMY_CARD]


@api.get("/transactions")
def get_transactions(
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
    category: AppCategory | None = None,
    card_id: Annotated[str | None, Query(alias="cardId")] = None,
    kind: Literal["income", "expense"] | None = None,
    search: str | None = None,
    limit: Annotated[int | None, Query(ge=1)] = None,
) -> list[Transaction]:
    """Newest first. The filters are TransactionFilters in src/types.ts; search matches merchant, description or category."""
    needle = search.strip().casefold() if search else ""
    result = [
        t
        for t in ledger.transactions(library)
        if (not from_ or t.date >= from_)
        and (not to or t.date <= to)
        and (not category or t.category == category)
        and (not card_id or t.card_id == card_id)
        and (kind is None or t.is_income == (kind == "income"))
        and (not needle or needle in f"{t.merchant} {t.raw_description} {t.category}".casefold())
    ]
    return result[:limit] if limit else result


@api.get("/transactions/{tx_id}")
def get_transaction(tx_id: str) -> Transaction:
    if (found := ledger.transaction(library, tx_id)) is None:
        raise HTTPException(404, "Transaction not found.")
    return found


class CategoryChange(AppModel):
    category: AppCategory
    always_for_merchant: bool = False


@api.patch("/transactions/{tx_id}")
def update_category(tx_id: str, change: CategoryChange) -> CategoryUpdate:
    if (update := ledger.recategorize(library, tx_id, change.category, change.always_for_merchant)) is None:
        raise HTTPException(404, "Transaction not found.")
    return update


def _document(doc_id: str) -> StoredDocument:
    if not ledger.is_document_id(doc_id) or (doc := library.get(doc_id)) is None:
        raise HTTPException(404, "Statement not found.")
    return doc


@api.get("/statements")
def get_statements() -> list[Statement]:
    """Newest first."""
    return [_statement(doc) for doc in library.documents()]


@api.post("/statements", status_code=202)
def upload_statement(file: UploadFile, response: Response, password: Annotated[str | None, Form()] = None) -> Statement:
    """Add a PDF statement and start reading and categorizing it; poll GET /api/statements/{id}.

    409 with code password_required when the PDF needs a password (or the one
    sent was wrong). A statement that is already in the library comes back
    with 200, and is processed again if it was left incomplete.
    """
    raw = file.file.read(MAX_BYTES + 1)  # anything longer is refused by prepare_pdf
    doc = library.find(hashlib.sha256(raw).hexdigest())
    if doc is not None:
        response.status_code = 200
    else:
        try:
            pdf = prepare_pdf(raw, password)
        except PasswordRequired as e:
            raise HTTPException(409, {"code": "password_required", "message": str(e)}) from e
        except StatementError as e:
            raise HTTPException(422, {"code": "invalid_pdf", "message": str(e)}) from e
        doc = library.add(file.filename or "statement.pdf", raw, render_pdf(pdf))
    _queue(doc)
    return _statement(doc)


@api.get("/statements/{doc_id}")
def get_statement(doc_id: str) -> Statement:
    return _statement(_document(doc_id))


@api.post("/statements/{doc_id}/process")
def process_statement(doc_id: str) -> Statement:
    """Process a statement again after it stopped short, e.g. once an API key is set."""
    doc = _document(doc_id)
    _queue(doc)
    return _statement(doc)


app.include_router(api)
