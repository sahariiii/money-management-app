"""The mobile app's ledger: categorized statement rows as the app's transactions and cards.

Models mirror src/types.ts in the Expo app (camelCase in JSON). Rows keep the
user's workbook categories, which the Streamlit pages and the workbook export
use; the app has its own fixed list, so each row shows under an app category:
the one picked in the app for that row (its app_category), else the app's
rule for its merchant, else Car for a car cost (CAR_TEXT), else the mapping of
its workbook category below.
"""

import re
import secrets
import threading
from datetime import date, datetime
from typing import Annotated, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from .store import Library, StoredDocument

# Must match EXPENSE_CATEGORIES and INCOME_CATEGORIES in src/types.ts.
ExpenseCategory = Literal[
    "Groceries",
    "Food",
    "Gas & EV charging",
    "Transport",
    "Car",
    "Shopping",
    "Health",
    "Entertainment",
    "Subscriptions",
    "Phone & Internet",
    "Utilities",
    "Housing",
    "Fees & interest",
    "Other",
]
IncomeCategory = Literal["Work", "Tax refund", "Side income", "Reimbursement", "Other income"]
AppCategory = Literal[ExpenseCategory, IncomeCategory]
APP_CATEGORIES: tuple[AppCategory, ...] = get_args(AppCategory)
INCOME_CATEGORIES: tuple[IncomeCategory, ...] = get_args(IncomeCategory)

# Workbook expense category -> app category. A workbook category that isn't
# listed shows under the app category with the same name, else under Other.
# Income rows use INCOME_CATEGORY_MAP below.
EXPENSE_CATEGORIES: dict[str, ExpenseCategory] = {
    "Bank": "Fees & interest",
    "Car insurance": "Car",
    "Car lease": "Car",
    "Car maintenance": "Car",
    "Car payment": "Car",
    "Parking": "Car",
    "Childcare": "Other",
    "Clothing": "Shopping",
    "Condo fees": "Housing",
    "Debt": "Other",
    "Electronics": "Shopping",
    "Gas": "Gas & EV charging",
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

# Car costs the workbook files elsewhere (e.g. parking under "Public transportation")
# show under Car when the vendor or statement description says so, except rows in
# CAR_TEXT_KEEPS: gas, which cards reward on its own, and housing (e.g. rent with parking).
CAR_TEXT_KEEPS: tuple[ExpenseCategory, ...] = ("Car", "Gas & EV charging", "Housing")
CAR_TEXT = re.compile(
    r"\b(cars?|automobiles?|vehicles?|parking|green p|car ?wash|407 ?etr)\b"
    # Parking companies; statements often run a lot number straight after the name.
    r"|\b(impark|spothero|honk ?mobile|indigo park|precise ?park)"
    # Not "auto" on its own: statements say "auto pay" and "auto-deposit" too.
    r"|\bauto ?(insurance|loan|lease|leasing|finance|financing|repair|service|body|parts)\b"
    r"|\b(toyota|honda|nissan|hyundai|kia|mazda|ford|gm|chevrolet|bmw|mercedes|audi|volkswagen|vw|tesla|subaru|lexus|acura)"
    r" ?(financial|finance|credit|leasing|lease)\b",
    re.IGNORECASE,
)

# Workbook income category -> app income category. Any workbook category starting
# with "Job" (e.g. "Job Sagard") is Work; one named like an app income category
# shows under it; anything else is Other income.
INCOME_CATEGORY_MAP: dict[str, IncomeCategory] = {
    "Side project": "Side income",
    "AIRBNB": "Side income",
    "Expense reimbursement": "Reimbursement",
    "Other": "Other income",
}

# Statements don't record their currency yet; the app is Canadian.
CURRENCY = "CAD"


class AppModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# Card and account numbers are only ever kept as their last 4 digits.
Last4 = Annotated[str, Field(pattern=r"^\d{4}$")]


class CardFields(AppModel):
    institution: str = Field(min_length=1, max_length=60)
    type: Literal["debit", "credit"]
    nickname: str = Field(min_length=1, max_length=60)
    last4: Last4
    account_last4: Last4 | None = None  # the card's bank account
    annual_fee: float = Field(ge=0)
    interest_rate: float = Field(ge=0, le=60)  # APR in percent; 0 for debit
    cycle_day: int = Field(ge=1, le=28)


class Card(CardFields):
    id: str
    is_placeholder: bool = False


class RewardRuleFields(AppModel):
    category: ExpenseCategory | Literal["*"]  # "*": every category without its own rule
    rate_percent: float = Field(gt=0, le=20)
    cap: float | None = Field(default=None, gt=0)  # monthly spend limit for this rate


class RewardRule(RewardRuleFields):
    card_id: str


class CardInput(CardFields):
    """A card as the app's add and edit forms send it (NewCardInput in src/types.ts)."""

    rules: list[RewardRuleFields] = []

    @model_validator(mode="after")
    def _one_rule_per_category(self) -> "CardInput":
        categories = [r.category for r in self.rules]
        if len(categories) != len(set(categories)):
            raise ValueError("Each category can only have one reward rule.")
        return self


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
    source: Literal["statement", "receipt"] = "statement"
    statement_id: str | None = None  # the statement (document id) it is on; None for receipt expenses
    receipt_id: str | None = None  # a scanned receipt saved with it (see "Scanned receipts" below)


class CategoryUpdate(AppModel):
    transaction: Transaction
    affected_count: int


# A statement's transactions are on the card whose account number ends in the
# statement's last 4 digits (see statement_match). Statements that match no card
# have theirs on this placeholder, which the app lists while there are any (or
# until the user adds a card) and can't edit or delete.
DUMMY_CARD = Card(
    id="card_dummy",
    institution="Placeholder",
    type="debit",
    nickname="Unmatched statements",
    last4="0000",
    annual_fee=0,
    interest_rate=0,
    cycle_day=1,
    is_placeholder=True,
)

# Transaction ids are "<document id>-<e|i><row>": the row's place in the
# statement's expenses or income list.
KINDS = {"e": "expenses", "i": "income"}
_LETTERS = {kind: letter for letter, kind in KINDS.items()}
_DOC_ID = re.compile(r"[a-z0-9-]+")
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
# Expenses added from receipts are "receipt_<hex>"; the underscore never appears in a document id.
_RECEIPT_ID = re.compile(r"receipt_[0-9a-f]{12}")

# The card id of an expense paid in cash (or with anything that isn't one of the user's cards).
CASH_CARD_ID = "cash"
# A receipt is for an expense with the same amount dated this many days either side of it:
# card purchases often post a day or two after the receipt's date.
MATCH_DAYS = 4

# Recategorizing rewrites budget.json files, and card edits cards.json; one write at a time.
_write_lock = threading.Lock()


def is_document_id(doc_id: str) -> bool:
    return bool(_DOC_ID.fullmatch(doc_id))


def app_category(kind: str, workbook_category: str | None) -> AppCategory:
    name = (workbook_category or "").strip()
    if kind == "income":
        if name in INCOME_CATEGORY_MAP:
            return INCOME_CATEGORY_MAP[name]
        if name.casefold().startswith("job"):
            return "Work"
        return next((c for c in INCOME_CATEGORIES if c.casefold() == name.casefold()), "Other income")
    if name in EXPENSE_CATEGORIES:
        return EXPENSE_CATEGORIES[name]
    expense_categories = (c for c in APP_CATEGORIES if c not in INCOME_CATEGORIES)
    return next((c for c in expense_categories if c.casefold() == name.casefold()), "Other")


def _is_car_cost(row: dict) -> bool:
    return bool(CAR_TEXT.search(f"{row.get('vendor') or ''} | {row.get('statement_description') or ''}"))


def _merchant(kind: str, row: dict) -> str:
    name = row.get("vendor") if kind == "expenses" else row.get("source")
    return name or row.get("statement_description") or "Unknown"


def _transaction(doc_id: str, kind: str, index: int, row: dict, rules: dict[str, str], card_id: str) -> Transaction | None:
    """The row as an app transaction; None for a row without a usable date."""
    date = row.get("date")
    if not isinstance(date, str) or not _ISO_DATE.fullmatch(date):
        return None
    amount = float(row.get("amount") or 0)
    merchant = _merchant(kind, row)
    picked = next((c for c in (row.get("app_category"), rules.get(merchant)) if c in APP_CATEGORIES), None)
    category = picked or app_category(kind, row.get("category"))
    # What the user picked in the app always wins over the CAR_TEXT check.
    if picked is None and kind == "expenses" and category not in CAR_TEXT_KEEPS and _is_car_cost(row):
        category = "Car"
    return Transaction(
        id=f"{doc_id}-{_LETTERS[kind]}{index:03d}",
        date=date,
        amount=abs(amount),
        currency=CURRENCY,
        raw_description=row.get("statement_description") or "",
        merchant=merchant,
        category=category,
        card_id=card_id,
        statement_id=doc_id,
        # A refund is a negative expense and money out recorded as income is
        # negative, so the sign says which way the money went.
        is_income=(kind == "income") == (amount >= 0),
    )


def _rows(budget: dict):
    for kind in KINDS.values():
        for index, row in enumerate(budget.get(kind) or []):
            yield kind, index, row


def _receipt_transaction(row: dict, rules: dict[str, str]) -> Transaction:
    merchant = row["merchant"]
    category = next(
        (c for c in (row.get("app_category"), rules.get(merchant)) if c in APP_CATEGORIES and c not in INCOME_CATEGORIES),
        "Other",
    )
    return Transaction(
        id=row["id"],
        date=row["date"],
        amount=row["amount"],
        currency=row.get("currency") or CURRENCY,
        raw_description=f"Receipt from {merchant}",
        merchant=merchant,
        category=category,
        card_id=row["card_id"],
        is_income=False,
        source="receipt",
    )


def card_by_number(library: Library, last4: str | None) -> Card | None:
    """The user's card whose number ends in `last4`, as printed on a receipt."""
    return next((c for c in _saved_cards(library)[0] if last4 and c.last4 == last4), None)


def find_match(txs: list[Transaction], amount: float, day: str | None, card_id: str | None = None) -> Transaction | None:
    """The expense a receipt is for: the same amount to the cent, dated within MATCH_DAYS of `day`
    (the closest wins; without a date, the most recent).

    With `card_id` (the card the receipt was paid with), only expenses on that card count, or on
    the placeholder, whose statement's card isn't known yet; that card wins a tie.
    """
    same = [t for t in txs if not t.is_income and abs(t.amount - amount) < 0.005]
    if card_id is not None:
        same = [t for t in same if t.card_id in (card_id, DUMMY_CARD.id)]
    if day is None:
        return max(same, key=lambda t: (t.date, t.card_id == card_id), default=None)
    when = date.fromisoformat(day)
    near = [(abs((date.fromisoformat(t.date) - when).days), t.card_id != card_id, t) for t in same]
    return min((p for p in near if p[0] <= MATCH_DAYS), key=lambda p: p[:2], default=(0, False, None))[2]


def transactions(library: Library) -> list[Transaction]:
    """Every categorized statement row and receipt expense in the library, newest first.

    A receipt expense is left out once a statement brings the same purchase (see find_match),
    so it isn't counted twice; that transaction shows under the receipt's category unless the
    user picked one for it.
    """
    rules = library.merchant_rules()
    saved = _saved_cards(library)[0]
    result: list[Transaction] = []
    explicit: set[str] = set()  # statement transactions whose category the user chose
    for doc in library.documents():
        if (budget := library.budget(doc)) is not None:
            card_id = _card_id(budget, saved)
            for kind, i, row in _rows(budget):
                if t := _transaction(doc.id, kind, i, row, rules, card_id):
                    result.append(t)
                    if row.get("app_category") in APP_CATEGORIES or rules.get(t.merchant) in APP_CATEGORIES:
                        explicit.add(t.id)

    linked = {s["transaction_id"]: s["id"] for s in library.scans() if s.get("transaction_id")}
    claimed: dict[str, str] = {}  # statement transaction id -> the receipt expense it replaces
    for receipt in (_receipt_transaction(row, rules) for row in library.receipt_expenses()):
        open_ = [t for t in result if t.source == "statement" and t.id not in claimed]
        # A cash purchase never shows up on a statement.
        paid_by_card = receipt.card_id != CASH_CARD_ID
        if not paid_by_card or (match := find_match(open_, receipt.amount, receipt.date, receipt.card_id)) is None:
            result.append(receipt)
            continue
        claimed[match.id] = receipt.id
        if match.id not in explicit:
            result[result.index(match)] = match.model_copy(update={"category": receipt.category})

    # Each transaction shows its own receipt, else that of the receipt expense it replaced.
    def receipt_of(t: Transaction) -> str | None:
        return linked.get(t.id) or linked.get(claimed.get(t.id, ""))

    result = [t.model_copy(update={"receipt_id": rid}) if (rid := receipt_of(t)) else t for t in result]
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
    """As transactions() shows it; a receipt expense a statement has since brought is still found by its id."""
    if found := next((t for t in transactions(library) if t.id == tx_id), None):
        return found
    row = next((r for r in library.receipt_expenses() if r["id"] == tx_id), None)
    if row is None:
        return None
    scan_id = next((s["id"] for s in library.scans() if s.get("transaction_id") == tx_id), None)
    return _receipt_transaction(row, library.merchant_rules()).model_copy(update={"receipt_id": scan_id})


def is_receipt_id(tx_id: str) -> bool:
    return bool(_RECEIPT_ID.fullmatch(tx_id))


def recategorize(library: Library, tx_id: str, category: AppCategory, always_for_merchant: bool) -> CategoryUpdate | None:
    """Show a transaction under `category` in the app; the workbook category is kept for the budget workbook.

    With `always_for_merchant`, every transaction from the same merchant follows,
    including ones from statements added later. Returns None for an unknown id.
    """
    with _write_lock:
        receipts = library.receipt_expenses()
        if is_receipt_id(tx_id):
            if (row := next((r for r in receipts if r["id"] == tx_id), None)) is None:
                return None
            merchant = row["merchant"]
            if not always_for_merchant:
                row["app_category"] = category
                library.save_receipt_expenses(receipts)
                return CategoryUpdate(transaction=transaction(library, tx_id), affected_count=1)
        elif (found := _locate(library, tx_id)) is None:
            return None
        else:
            doc, budget, kind, index = found
            merchant = _merchant(kind, budget[kind][index])
            if not always_for_merchant:
                budget[kind][index]["app_category"] = category
                library.save_budget(doc, budget)
                return CategoryUpdate(transaction=transaction(library, tx_id), affected_count=1)

        library.save_merchant_rules({**library.merchant_rules(), merchant: category})
        # Rows picked one at a time before now follow the rule too.
        same = [r for r in receipts if r["merchant"] == merchant]
        for r in same:
            r.pop("app_category", None)
        if same:
            library.save_receipt_expenses(receipts)
        affected = len(same)
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


# ---------------------------------------------------------------------------
# Cards


def _saved_cards(library: Library) -> tuple[list[Card], list[RewardRule]]:
    data = library.cards()
    return (
        [Card.model_validate(c) for c in data.get("cards", [])],
        [RewardRule.model_validate(r) for r in data.get("reward_rules", [])],
    )


def _save_cards(library: Library, cards_: list[Card], rules: list[RewardRule]) -> None:
    library.save_cards({"cards": [c.model_dump() for c in cards_], "reward_rules": [r.model_dump() for r in rules]})


def _from_input(card_id: str, data: CardInput) -> tuple[Card, list[RewardRule]]:
    card = Card(id=card_id, **data.model_dump(exclude={"rules"}))
    return card, [RewardRule(card_id=card_id, **r.model_dump()) for r in data.rules]


CardMatch = Literal["matched", "no_match", "no_account_number", "pending"]


def statement_account_last4(budget: dict) -> str | None:
    return (budget.get("account") or {}).get("last4")


def _matching_card(budget: dict, saved: list[Card]) -> Card | None:
    """The first card added whose account number ends in the statement's last 4 digits."""
    last4 = statement_account_last4(budget)
    return next((c for c in saved if last4 and c.account_last4 == last4), None)


def _card_id(budget: dict, saved: list[Card]) -> str:
    """The card a statement's transactions are on: the matching card, else the placeholder."""
    return card.id if (card := _matching_card(budget, saved)) else DUMMY_CARD.id


def statement_match(library: Library, budget: dict) -> tuple[CardMatch, str | None]:
    """How a categorized statement matches the user's cards, and the matching card's id.

    "pending": statements categorized before budget.json recorded the account, until it is filled in.
    """
    if "account" not in budget:
        return "pending", None
    if not statement_account_last4(budget):
        return "no_account_number", None
    card = _matching_card(budget, _saved_cards(library)[0])
    return ("matched", card.id) if card else ("no_match", None)


def cards(library: Library) -> list[Card]:
    """The user's cards, in the order added, plus the placeholder while any statement matches none of them."""
    saved = _saved_cards(library)[0]
    budgets = (b for doc in library.documents() if (b := library.budget(doc)) is not None)
    unmatched = not saved or any(_matching_card(b, saved) is None for b in budgets)
    return [*saved, DUMMY_CARD] if unmatched else saved


def set_statement_fields(library: Library, doc: StoredDocument, fields: dict) -> None:
    """Adds what was read from a categorized statement later to its budget.json: its "account"
    (categorize.account_record), or its "period" and "rewards" (categorize.summary_record)."""
    with _write_lock:
        if (budget := library.budget(doc)) is not None:
            library.save_budget(doc, {**budget, **fields})


class ReportedRewardLine(AppModel):
    label: str
    rate_percent: float | None
    amount: float


class ReportedRewards(AppModel):
    """The rewards a statement says it earned (StatementRewards.reported in src/types.ts)."""

    program: str | None
    unit: Literal["dollars", "points", "miles"]
    earned: float  # the lines added up
    lines: list[ReportedRewardLine]


def statement_rewards(budget: dict) -> ReportedRewards | None:
    """The rewards summary printed on the statement; None when it prints none or it wasn't read yet."""
    if not (rewards := budget.get("rewards")):
        return None
    lines = [ReportedRewardLine.model_validate(line) for line in rewards.get("lines") or []]
    return ReportedRewards(
        program=rewards.get("program"),
        unit=rewards.get("unit") or "dollars",
        earned=round(sum(line.amount for line in lines), 2),
        lines=lines,
    )


def statement_period(budget: dict) -> tuple[str | None, str | None]:
    period = budget.get("period") or {}
    return period.get("start"), period.get("end")


def reward_rules(library: Library) -> list[RewardRule]:
    return _saved_cards(library)[1]


def add_card(library: Library, data: CardInput) -> Card:
    with _write_lock:
        saved, rules = _saved_cards(library)
        card, card_rules = _from_input(f"card_{secrets.token_hex(6)}", data)
        _save_cards(library, [*saved, card], [*rules, *card_rules])
    return card


def update_card(library: Library, card_id: str, data: CardInput) -> Card | None:
    """Replaces the card's details and reward rules; None for an unknown card (or the placeholder)."""
    with _write_lock:
        saved, rules = _saved_cards(library)
        if not any(c.id == card_id for c in saved):
            return None
        card, card_rules = _from_input(card_id, data)
        _save_cards(
            library,
            [card if c.id == card_id else c for c in saved],
            [*(r for r in rules if r.card_id != card_id), *card_rules],
        )
    return card


def delete_card(library: Library, card_id: str) -> bool:
    """Removes the card and its reward rules; False for an unknown card (or the placeholder)."""
    with _write_lock:
        saved, rules = _saved_cards(library)
        if not any(c.id == card_id for c in saved):
            return False
        _save_cards(library, [c for c in saved if c.id != card_id], [r for r in rules if r.card_id != card_id])
    return True


# ---------------------------------------------------------------------------
# Expenses added from receipts


class ExpenseInput(AppModel):
    """An expense the user adds from a scanned receipt (NewExpenseInput in src/types.ts)."""

    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    amount: float = Field(gt=0, le=1_000_000)
    currency: str = Field(default=CURRENCY, pattern=r"^[A-Z]{3}$")
    merchant: str = Field(min_length=1, max_length=80)
    category: AppCategory
    card_id: str  # one of the user's cards, or CASH_CARD_ID
    receipt_id: str | None = None  # the scan it was read from, saved with it

    @model_validator(mode="after")
    def _check(self) -> "ExpenseInput":
        date.fromisoformat(self.date)  # a real day, not just the right shape
        if self.category in INCOME_CATEGORIES:
            raise ValueError("An expense can't be in an income category.")
        return self


class UnknownCard(ValueError):
    pass


def add_receipt_expense(library: Library, data: ExpenseInput) -> Transaction:
    if data.card_id != CASH_CARD_ID and not any(c.id == data.card_id for c in _saved_cards(library)[0]):
        raise UnknownCard("That card doesn't exist anymore.")
    row = {
        "id": f"receipt_{secrets.token_hex(6)}",
        "date": data.date,
        "amount": round(data.amount, 2),
        "currency": data.currency,
        "merchant": data.merchant.strip(),
        "app_category": data.category,
        "card_id": data.card_id,
        "added_at": datetime.now().isoformat(timespec="seconds"),
    }
    with _write_lock:
        library.save_receipt_expenses([*library.receipt_expenses(), row])
    if data.receipt_id:
        attach_receipt(library, data.receipt_id, row["id"])
    return transaction(library, row["id"])


def delete_receipt_expense(library: Library, tx_id: str) -> bool:
    """Removes the expense and its receipt; False when there is no such receipt expense."""
    with _write_lock:
        rows = library.receipt_expenses()
        if not any(r["id"] == tx_id for r in rows):
            return False
        library.save_receipt_expenses([r for r in rows if r["id"] != tx_id])
        for scan in library.scans():
            if scan.get("transaction_id") == tx_id:
                library.delete_scan(scan["id"])
    return True


# ---------------------------------------------------------------------------
# Scanned receipts
#
# Every scan is saved: the photo Claude read and what it read from it. It belongs
# to a transaction once the user adds it as an expense or saves it to the expense
# it matched; scans that never get one are deleted after a day.

_SCAN_ID = re.compile(r"scan_[0-9a-f]{12}")
UNSAVED_SCAN_HOURS = 24


def is_scan_id(scan_id: str) -> bool:
    return bool(_SCAN_ID.fullmatch(scan_id))


def save_scan(library: Library, read: dict, image_jpeg: bytes) -> str:
    """Keeps a new scan, for now without a transaction; returns its id."""
    now = datetime.now()
    with _write_lock:
        for old in library.scans():
            scanned = datetime.fromisoformat(old["scanned_at"])
            if not old.get("transaction_id") and (now - scanned).total_seconds() > UNSAVED_SCAN_HOURS * 3600:
                library.delete_scan(old["id"])
        scan_id = f"scan_{secrets.token_hex(6)}"
        library.save_scan({"id": scan_id, "scanned_at": now.isoformat(timespec="seconds"), **read, "transaction_id": None}, image_jpeg)
    return scan_id


def attach_receipt(library: Library, scan_id: str, tx_id: str) -> Transaction | None:
    """Saves the scan with the transaction, replacing a receipt it had; None for an unknown scan or transaction."""
    if not is_scan_id(scan_id) or transaction(library, tx_id) is None:
        return None
    with _write_lock:
        if (scan := library.scan(scan_id)) is None:
            return None
        for other in library.scans():
            if other.get("transaction_id") == tx_id and other["id"] != scan_id:
                library.delete_scan(other["id"])
        library.save_scan({**scan, "transaction_id": tx_id})
    return transaction(library, tx_id)


def delete_receipt(library: Library, scan_id: str) -> bool:
    """Deletes a scan and its photo; the transaction stays. False for an unknown scan."""
    with _write_lock:
        if not is_scan_id(scan_id) or library.scan(scan_id) is None:
            return False
        library.delete_scan(scan_id)
    return True
