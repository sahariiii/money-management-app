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

import base64
import hashlib
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated, Literal

import anthropic
from fastapi import APIRouter, Depends, FastAPI, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import Field

from . import assistant, auth, ledger, planning, receipts, service
from .docai import render_pdf
from .docai.pipeline import EXTRACTION_ENGINE
from .ledger import AppCategory, AppModel, Card, CardInput, CategoryUpdate, RewardRule, Transaction
from .llm import ExtractionError, make_client, start_trace
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
    account_last4: str | None  # the account number printed on it, last 4 digits
    card_match: ledger.CardMatch | None  # None until categorized
    card_id: str | None  # the card whose account number matches
    period_start: str | None  # the statement period as printed, YYYY-MM-DD
    period_end: str | None
    rewards: ledger.ReportedRewards | None  # what the statement says it earned; None if it prints none


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
    match, card_id = ledger.statement_match(library, budget) if budget is not None else (None, None)
    period_start, period_end = ledger.statement_period(budget) if budget else (None, None)
    return Statement(
        id=doc.id,
        name=doc.name,
        uploaded_at=doc.added,
        page_count=doc.page_count,
        pages_done=library.transcribed_pages(doc, EXTRACTION_ENGINE),
        status=status,
        message=message,
        transaction_count=len(budget["expenses"]) + len(budget["income"]) if budget else None,
        account_last4=ledger.statement_account_last4(budget) if budget else None,
        card_match=match,
        card_id=card_id,
        period_start=period_start,
        period_end=period_end,
        rewards=ledger.statement_rewards(budget) if budget else None,
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


def _identify_account(doc_id: str) -> None:
    """Fills in the account of a statement categorized before budget.json recorded it, so it can match a card."""
    doc = library.get(doc_id)
    try:
        if doc and service.needs_account(library, doc) and not service.identify_statement_account(library, doc, make_client()):
            log.warning("No transcription to read the account of %s from.", doc_id)
    except Exception:  # it stays "pending"; the next start tries again
        log.exception("Reading the account of %s failed", doc_id)


def _read_summary(doc_id: str) -> None:
    """Fills in the period and printed rewards of a statement categorized before budget.json kept them.

    Queued after _identify_account, so a statement's account type is known by the time it runs.
    """
    doc = library.get(doc_id)
    try:
        if doc and service.needs_summary(library, doc) and not service.read_statement_summary(library, doc, make_client()):
            log.warning("No transcription to read the rewards of %s from.", doc_id)
    except Exception:  # the app shows its own estimate meanwhile; the next start tries again
        log.exception("Reading the rewards of %s failed", doc_id)


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
            auth.APP_CLERK_KEY_ENV,
            auth.TOKEN_ENV,
        )
    elif auth.publishable_key() and not os.environ.get(auth.ALLOWED_USERS_ENV):
        log.warning("%s isn't set: anyone who can sign in to the app can read your statements.", auth.ALLOWED_USERS_ENV)
    if missing := [doc.id for doc in library.documents() if service.needs_account(library, doc)]:
        if has_api_key():
            log.info("Reading the account number of %d older statement(s) to match them to cards.", len(missing))
            for doc_id in missing:
                _jobs.submit(_identify_account, doc_id)
        else:
            log.warning("%d statement(s) can't be matched to cards until ANTHROPIC_API_KEY is set.", len(missing))
    # A statement still missing its account may turn out to be a card's, so it is queued too.
    unread = [doc.id for doc in library.documents() if service.needs_summary(library, doc) or doc.id in missing]
    if unread and has_api_key():
        log.info("Reading the printed rewards of %d older statement(s).", len(unread))
        for doc_id in unread:
            _jobs.submit(_read_summary, doc_id)
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
    return ledger.cards(library)


@api.get("/reward-rules")
def get_reward_rules() -> list[RewardRule]:
    return ledger.reward_rules(library)


@api.post("/cards", status_code=201)
def add_card(data: CardInput) -> Card:
    return ledger.add_card(library, data)


@api.put("/cards/{card_id}")
def update_card(card_id: str, data: CardInput) -> Card:
    if (card := ledger.update_card(library, card_id, data)) is None:
        raise HTTPException(404, "Card not found.")
    return card


@api.delete("/cards/{card_id}", status_code=204)
def delete_card(card_id: str) -> Response:
    if not ledger.delete_card(library, card_id):
        raise HTTPException(404, "Card not found.")
    return Response(status_code=204)


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


@api.post("/transactions", status_code=201)
def add_expense(data: ledger.ExpenseInput) -> Transaction:
    """An expense from a scanned receipt; hidden again once a statement brings the same purchase."""
    try:
        return ledger.add_receipt_expense(library, data)
    except ledger.UnknownCard as e:
        raise HTTPException(422, str(e)) from e


@api.delete("/transactions/{tx_id}", status_code=204)
def delete_expense(tx_id: str) -> Response:
    """Only expenses added from receipts can be deleted; statements are the record of the rest."""
    if ledger.is_receipt_id(tx_id) and ledger.delete_receipt_expense(library, tx_id):
        return Response(status_code=204)
    if ledger.transaction(library, tx_id) is not None:
        raise HTTPException(409, "Transactions from statements can't be deleted.")
    raise HTTPException(404, "Transaction not found.")


# ---------------------------------------------------------------------------
# Budgets and the savings goal


@api.get("/budgets")
def get_budgets() -> list[planning.Budget]:
    """Monthly limits per category; the app works out what was spent against them."""
    return planning.budgets(library)


@api.put("/budgets/{category}")
def set_budget(category: ledger.ExpenseCategory, body: planning.BudgetLimit) -> planning.Budget:
    return planning.set_budget(library, category, body.monthly_limit)


@api.get("/goal")
def get_goal() -> planning.SavingsGoal | None:
    """The savings goal, or null when there is none; the app works out its progress from the transactions."""
    return planning.goal(library)


@api.put("/goal")
def save_goal(plan: planning.GoalPlan) -> planning.SavingsGoal:
    """Saves the goal and replaces every budget with the ones that reach it."""
    return planning.save_goal(library, plan)


@api.delete("/goal", status_code=204)
def delete_goal() -> Response:
    """Removes the goal; the budgets stay."""
    if not planning.delete_goal(library):
        raise HTTPException(404, "There is no savings goal.")
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Receipts


class ReceiptItem(AppModel):
    description: str
    amount: float


class ReceiptScan(AppModel):
    merchant: str
    date: str | None
    subtotal: float | None
    tax: float | None
    tax_label: str | None
    total: float
    currency: str
    items: list[ReceiptItem]
    category: AppCategory  # suggested
    card_last4: str | None  # the card number printed on it, last 4 digits
    card_id: str | None  # the user's card with that number
    matched_transaction: Transaction | None  # already in the ledger
    receipt_id: str  # the saved scan; add it as an expense or attach it to the match to keep it


class Receipt(AppModel):
    """A saved scan: what was read from the receipt, and its photo."""

    id: str
    scanned_at: str
    merchant: str
    date: str | None
    subtotal: float | None
    tax: float | None
    tax_label: str | None
    total: float
    currency: str
    items: list[ReceiptItem]
    card_last4: str | None
    transaction_id: str | None
    image_data_url: str | None  # the photo as a data: URL, so the app can show it without auth headers


class ReceiptAttach(AppModel):
    transaction_id: str


@api.get("/receipts/{scan_id}")
def get_receipt(scan_id: str) -> Receipt:
    if not ledger.is_scan_id(scan_id) or (scan := library.scan(scan_id)) is None:
        raise HTTPException(404, "Receipt not found.")
    image = library.scan_image(scan_id)
    data_url = f"data:image/jpeg;base64,{base64.b64encode(image).decode('ascii')}" if image else None
    return Receipt(**scan, image_data_url=data_url)


@api.post("/receipts/{scan_id}/attach")
def attach_receipt(scan_id: str, body: ReceiptAttach) -> Transaction:
    """Saves the receipt with a transaction (replacing one it had), e.g. the expense it matched."""
    if (tx := ledger.attach_receipt(library, scan_id, body.transaction_id)) is None:
        raise HTTPException(404, "Receipt or transaction not found.")
    return tx


@api.delete("/receipts/{scan_id}", status_code=204)
def delete_receipt(scan_id: str) -> Response:
    """Removes the receipt and its photo; the transaction stays."""
    if not ledger.delete_receipt(library, scan_id):
        raise HTTPException(404, "Receipt not found.")
    return Response(status_code=204)


@api.post("/receipts/scan")
def scan_receipt(image: UploadFile) -> ReceiptScan:
    """Reads a receipt photo, saves it, and finds the expense it is for if that's in the ledger already."""
    if not has_api_key():
        raise HTTPException(503, "Reading receipts uses Claude, and no Anthropic API key is set on the server.")
    raw = image.file.read(receipts.MAX_UPLOAD_BYTES + 1)
    if len(raw) > receipts.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "That photo is too large. Try one under 20 MB.")
    try:
        photo = receipts.prepare_image(raw)
    except receipts.ReceiptError as e:
        raise HTTPException(415, str(e)) from e
    with start_trace("receipt", input={"bytes": len(raw)}):
        try:
            data = receipts.read_receipt(make_client(), photo).output
        except (ExtractionError, anthropic.APIError) as e:
            raise HTTPException(502, f"Couldn't read the receipt: {e}") from e

    try:
        day = date.fromisoformat(data.date).isoformat() if data.date else None
    except ValueError:
        day = None
    last4 = receipts.last4(data.card_last4)
    card = ledger.card_by_number(library, last4)
    read = {
        "merchant": data.merchant,
        "date": day,
        "subtotal": data.subtotal,
        "tax": data.tax,
        "tax_label": data.tax_label,
        "total": round(data.total, 2),
        "currency": (data.currency or ledger.CURRENCY).upper()[:3],
        "items": [{"description": i.description, "amount": i.amount} for i in data.items],
        "card_last4": last4,
    }
    return ReceiptScan(
        **read,
        category=data.category,
        card_id=card.id if card else None,
        matched_transaction=ledger.find_match(ledger.transactions(library), data.total, day, card.id if card else None),
        receipt_id=ledger.save_scan(library, read, photo),
    )


# ---------------------------------------------------------------------------
# Assistant


class ChatQuestion(AppModel):
    text: str = Field(min_length=1, max_length=2000)


@api.get("/chat")
def get_chat() -> list[assistant.ChatMessage]:
    """The conversation, oldest first."""
    return assistant.history(library)


@api.post("/chat")
def send_chat(question: ChatQuestion) -> assistant.ChatMessage:
    """Asks the assistant; returns its answer once Claude is done, which can take a while. Both are saved."""
    if not has_api_key():
        raise HTTPException(503, "The assistant uses Claude, and no Anthropic API key is set on the server.")
    with start_trace("chat", input={"question": question.text}) as trace:
        try:
            reply = assistant.ask(make_client(), library, question.text.strip())
        except assistant.AssistantError as e:
            raise HTTPException(422, str(e)) from e
        except anthropic.APIError as e:
            log.exception("The assistant's Claude call failed")
            raise HTTPException(502, f"The assistant couldn't reach Claude: {e}") from e
        trace.log(output={"text": reply.text, "summary": reply.summary.model_dump() if reply.summary else None})
    return reply


@api.delete("/chat", status_code=204)
def clear_chat() -> Response:
    assistant.clear(library)
    return Response(status_code=204)


def _document(doc_id: str) -> StoredDocument:
    if not ledger.is_document_id(doc_id) or (doc := library.get(doc_id)) is None:
        raise HTTPException(404, "Statement not found.")
    return doc


@api.get("/statements")
def get_statements() -> list[Statement]:
    """Newest first."""
    return [_statement(doc) for doc in library.documents()]


@api.post("/statements", status_code=202)
def upload_statement(
    file: UploadFile,
    response: Response,
    password: Annotated[str | None, Form()] = None,
    filename: Annotated[str | None, Form()] = None,
) -> Statement:
    """Add a PDF statement and start reading and categorizing it; poll GET /api/statements/{id}.

    `filename` is the name the user picked, when the upload itself carries another
    (the phone app uploads a cached copy). 409 with code password_required when the
    PDF needs a password (or the one sent was wrong). A statement that is already in
    the library comes back with 200, and is processed again if it was left incomplete.
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
        doc = library.add(filename or file.filename or "statement.pdf", raw, render_pdf(pdf))
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
