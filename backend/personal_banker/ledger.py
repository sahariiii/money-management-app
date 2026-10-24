"""The mobile app's ledger: categorized statement rows as the app's transactions and cards.

Models mirror src/types.ts in the Expo app (camelCase in JSON). Rows keep the
user's workbook categories, which the Streamlit pages and the workbook export
use; the app has its own fixed list, so each row shows under an app category:
the one picked in the app for that row (its app_category), else the app's
rule for its merchant, else the mapping of its workbook category below.
"""

import re
import threading
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from .store import Library, StoredDocument

# Must match CATEGORIES in src/types.ts.
AppCategory = Literal[
    "Groceries",
    "Food",
    "Transport",
    "Shopping",
    "Health",
    "Entertainment",
    "Subscriptions",
    "Phone & Internet",
    "Utilities",
    "Housing",
    "Income",
    "Other",
]
APP_CATEGORIES: tuple[AppCategory, ...] = get_args(AppCategory)

# Workbook expense category -> app category. A workbook category that isn't
# listed shows under the app category with the same name, else under Other.
# Income rows always show as Income.
EXPENSE_CATEGORIES: dict[str, AppCategory] = {
    "Bank": "Other",
    "Car maintenance": "Transport",
    "Car payment": "Transport",
    "Childcare": "Other",
    "Clothing": "Shopping",
    "Condo fees": "Housing",
    "Debt": "Other",
    "Electronics": "Shopping",
    "Gas": "Transport",
    "Gifts": "Shopping",
    "Going out": "Food",
    "Gym": "Health",
    "Home maintenance": "Housing",
    "Insurance": "Other",
    "Lawyer": "Other",
    "Medical": "Health",
    "Mortgage": "Housing",
    "Public transportation": "Transport",
    "Rent": "Housing",
    "Restaurant": "Food",
    "Subscription": "Subscriptions",
    "Telecom": "Phone & Internet",
    "Travel": "Transport",
    "Work": "Other",
}

# Statements don't record their currency yet; the app is Canadian.
CURRENCY = "CAD"


class AppModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Card(AppModel):
    id: str
    institution: str
    type: Literal["debit", "credit"]
    nickname: str
    last4: str
    account_last4: str | None = None  # last 4 digits of the card's bank account; never the full number
    annual_fee: float
    interest_rate: float
    cycle_day: int


class Transaction(AppModel):
    id: str
    date: str
    amount: float  # always positive; is_income gives the direction
    currency: str
    raw_description: str
    merchant: str
    category: AppCategory
    card_id: str
    is_income: bool


class CategoryUpdate(AppModel):
    transaction: Transaction
    affected_count: int


# The library doesn't know which card or account a statement belongs to yet,
# so every transaction is on this placeholder.
DUMMY_CARD = Card(
    id="card_dummy",
    institution="Placeholder",
    type="debit",
    nickname="Dummy card",
    last4="0000",
    annual_fee=0,
    interest_rate=0,
    cycle_day=1,
)

# Transaction ids are "<document id>-<e|i><row>": the row's place in the
# statement's expenses or income list.
KINDS = {"e": "expenses", "i": "income"}
_LETTERS = {kind: letter for letter, kind in KINDS.items()}
_DOC_ID = re.compile(r"[a-z0-9-]+")
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")

# Recategorizing rewrites budget.json files; one write at a time.
_write_lock = threading.Lock()


def is_document_id(doc_id: str) -> bool:
    return bool(_DOC_ID.fullmatch(doc_id))


def app_category(kind: str, workbook_category: str | None) -> AppCategory:
    if kind == "income":
        return "Income"
    name = (workbook_category or "").strip()
    if name in EXPENSE_CATEGORIES:
        return EXPENSE_CATEGORIES[name]
    return next((c for c in APP_CATEGORIES if c != "Income" and c.casefold() == name.casefold()), "Other")


def _merchant(kind: str, row: dict) -> str:
    name = row.get("vendor") if kind == "expenses" else row.get("source")
    return name or row.get("statement_description") or "Unknown"


def _transaction(doc_id: str, kind: str, index: int, row: dict, rules: dict[str, str]) -> Transaction | None:
    """The row as an app transaction; None for a row without a usable date."""
    date = row.get("date")
    if not isinstance(date, str) or not _ISO_DATE.fullmatch(date):
        return None
    amount = float(row.get("amount") or 0)
    merchant = _merchant(kind, row)
    category = next(
        (c for c in (row.get("app_category"), rules.get(merchant)) if c in APP_CATEGORIES),
        app_category(kind, row.get("category")),
    )
    return Transaction(
        id=f"{doc_id}-{_LETTERS[kind]}{index:03d}",
        date=date,
        amount=abs(amount),
        currency=CURRENCY,
        raw_description=row.get("statement_description") or "",
        merchant=merchant,
        category=category,
        card_id=DUMMY_CARD.id,
        # A refund is a negative expense and money out recorded as income is
        # negative, so the sign says which way the money went.
        is_income=(kind == "income") == (amount >= 0),
    )


def _rows(budget: dict):
    for kind in KINDS.values():
        for index, row in enumerate(budget.get(kind) or []):
            yield kind, index, row


def transactions(library: Library) -> list[Transaction]:
    """Every categorized row in the library, newest first."""
    rules = library.merchant_rules()
    result = []
    for doc in library.documents():
        if (budget := library.budget(doc)) is not None:
            result += [t for kind, i, row in _rows(budget) if (t := _transaction(doc.id, kind, i, row, rules))]
    return sorted(result, key=lambda t: (t.date, t.id), reverse=True)


def _locate(library: Library, tx_id: str) -> tuple[StoredDocument, dict, str, int] | None:
    """(document, its budget, kind, row index) for a transaction id; None when there is no such row."""
    doc_id, _, ref = tx_id.rpartition("-")
    if not is_document_id(doc_id) or ref[:1] not in KINDS or not ref[1:].isdigit():
        return None
    doc = library.get(doc_id)
    budget = library.budget(doc) if doc else None
    kind, index = KINDS[ref[0]], int(ref[1:])
    if budget is None or index >= len(budget.get(kind) or []):
        return None
    return doc, budget, kind, index


def transaction(library: Library, tx_id: str) -> Transaction | None:
    if (found := _locate(library, tx_id)) is None:
        return None
    doc, budget, kind, index = found
    return _transaction(doc.id, kind, index, budget[kind][index], library.merchant_rules())


def recategorize(library: Library, tx_id: str, category: AppCategory, always_for_merchant: bool) -> CategoryUpdate | None:
    """Show a transaction under `category` in the app; the workbook category is kept for the budget workbook.

    With `always_for_merchant`, every transaction from the same merchant follows,
    including ones from statements added later. Returns None for an unknown id.
    """
    with _write_lock:
        if (found := _locate(library, tx_id)) is None:
            return None
        doc, budget, kind, index = found
        if not always_for_merchant:
            budget[kind][index]["app_category"] = category
            library.save_budget(doc, budget)
            return CategoryUpdate(transaction=transaction(library, tx_id), affected_count=1)

        merchant = _merchant(kind, budget[kind][index])
        library.save_merchant_rules({**library.merchant_rules(), merchant: category})
        # Rows picked one at a time before now follow the rule too.
        affected = 0
        for other in library.documents():
            if (other_budget := library.budget(other)) is None:
                continue
            changed = False
            for other_kind, _, row in _rows(other_budget):
                if _merchant(other_kind, row) == merchant:
                    affected += 1
                    changed |= row.pop("app_category", None) is not None
            if changed:
                library.save_budget(other, other_budget)
        return CategoryUpdate(transaction=transaction(library, tx_id), affected_count=affected)
