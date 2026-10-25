"""The mobile app's ledger: one user's transactions and cards, as the app sees them.

Models mirror src/types.ts in the Expo app (camelCase in JSON). A statement's
rows arrive from the categorizer in budget.json with the user's workbook
categories; import_statement stores them as transaction records with ids that
never change. Each shows under an app category: the one picked in the app for
it (user_category), else the app's rule for its merchant, else its auto_category
(Car for a car cost per CAR_TEXT, else the mapping of its workbook category below).
"""

import re
import secrets
from collections import Counter
from datetime import date, datetime
from hashlib import sha256
from typing import Literal

from pydantic import Field, model_validator

from .datastore import DataStore
from .records import (
    APP_CATEGORIES,
    INCOME_CATEGORIES,
    AppCategory,
    AppModel,
    Card,
    CardFields,
    ExpenseCategory,
    IncomeCategory,
    Last4,
    RewardRule,
    RewardRuleFields,
    ScanRecord,
    StatementRecord,
    TransactionRecord,
)

__all__ = [  # re-exported from records for existing imports
    "APP_CATEGORIES",
    "INCOME_CATEGORIES",
    "AppCategory",
    "AppModel",
    "Card",
    "CardFields",
    "ExpenseCategory",
    "IncomeCategory",
    "Last4",
    "RewardRule",
    "RewardRuleFields",
]

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
    # Returns (see link_refunds): on a refund, the purchase it returns; on a purchase, what came back.
    refund_of: str | None = None
    refunded_amount: float = 0.0
    refund_ids: list[str] = []


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

# A statement row's place in budget.json: "e" for its expenses list, "i" for income.
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


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


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


# ---------------------------------------------------------------------------
# Importing a statement's rows


def dedup_key(account_last4: str | None, day: str, is_income: bool, amount: float, description: str, occurrence: int) -> str:
    """What makes a statement transaction unique: the account, day, direction, amount and description
    as printed, plus which occurrence it is on its statement (two identical coffees on one day are two
    transactions). Overlapping statements of the same account print the same rows, so they share keys."""
    text = " ".join(description.casefold().split())
    parts = [account_last4 or "?", day, "in" if is_income else "out", f"{amount:.2f}", text, str(occurrence)]
    return sha256("|".join(parts).encode()).hexdigest()[:24]


def _rows(budget: dict):
    for kind in KINDS.values():
        for index, row in enumerate(budget.get(kind) or []):
            yield kind, index, row


def import_statement(store: DataStore, doc_id: str, budget: dict, id_for=None) -> StatementRecord:
    """Stores the categorizer's rows for a statement as transactions, and marks the statement categorized.

    Importing the same statement again (e.g. after edits in Streamlit) keeps each transaction's id
    and the category picked for it in the app, matching rows by dedup_key. A row another statement
    already brought is stored with duplicate_of and left out of the ledger. `id_for(position)` names
    new transactions (migrate.py keeps their old ids); by default they get a random id.
    """
    existing = {t.dedup_key: t for t in store.transactions() if t.statement_id == doc_id}
    earlier = {
        t.dedup_key: t.id
        for t in store.transactions()
        if t.statement_id != doc_id and t.source == "statement" and t.duplicate_of is None and t.dedup_key
    }
    statement = store.statement(doc_id)
    account = budget["account"] if "account" in budget else (statement.account if statement else None)
    last4 = (account or {}).get("last4")

    seen: Counter = Counter()
    records: list[TransactionRecord] = []
    for kind, index, row in _rows(budget):
        day = row.get("date")
        if not isinstance(day, str) or not _ISO_DATE.fullmatch(day):
            continue  # not usable without a date; it stays in budget.json for the workbook
        amount = float(row.get("amount") or 0)
        # A refund is a negative expense and money out recorded as income is
        # negative, so the sign says which way the money went.
        is_income = (kind == "income") == (amount >= 0)
        description = row.get("statement_description") or ""
        auto = app_category(kind, row.get("category"))
        if kind == "expenses" and auto not in CAR_TEXT_KEEPS and _is_car_cost(row):
            auto = "Car"
        base = (last4, day, is_income, abs(amount), description)
        seen[base] += 1
        key = dedup_key(*base, seen[base])
        position = f"{doc_id}-{_LETTERS[kind]}{index:03d}"
        before = existing.get(key)
        picked = row.get("app_category") if row.get("app_category") in APP_CATEGORIES else None  # older app edits
        records.append(
            TransactionRecord(
                id=before.id if before else (id_for(position) if id_for else f"tx_{secrets.token_hex(8)}"),
                source="statement",
                date=day,
                amount=abs(amount),
                is_income=is_income,
                currency=CURRENCY,
                merchant=_merchant(kind, row),
                raw_description=description,
                auto_category=auto,
                user_category=before.user_category if before else picked,
                statement_id=doc_id,
                position=position,
                dedup_key=key,
                duplicate_of=earlier.get(key),
                workbook_category=row.get("category"),
                created_at=before.created_at if before else _now(),
            )
        )

    kept = {r.id for r in records}
    store.delete_transactions([t.id for t in existing.values() if t.id not in kept])
    store.save_transactions(records)
    fields: dict = {
        "categorized": True,
        "row_count": len(budget.get("expenses") or []) + len(budget.get("income") or []),
        "duplicate_count": sum(r.duplicate_of is not None for r in records),
        "account": account,
    }
    if "rewards" in budget:
        period = budget.get("period") or {}
        fields |= {"summary_read": True, "period_start": period.get("start"), "period_end": period.get("end"), "rewards": budget["rewards"]}
    return store.update_statement(doc_id, **fields)


# ---------------------------------------------------------------------------
# Reading the ledger


def _shown_category(record: TransactionRecord, rules: dict[str, str]) -> AppCategory:
    if record.source == "receipt":
        # A receipt is always an expense, so an income category picked or ruled for it doesn't apply.
        options = (record.user_category, rules.get(record.merchant))
        return next((c for c in options if c in APP_CATEGORIES and c not in INCOME_CATEGORIES), "Other")
    return next((c for c in (record.user_category, rules.get(record.merchant)) if c in APP_CATEGORIES), record.auto_category)


def _is_explicit(record: TransactionRecord, rules: dict[str, str]) -> bool:
    """The user chose its category, one by one or with a merchant rule."""
    return record.user_category is not None or rules.get(record.merchant) in APP_CATEGORIES


def _as_transaction(record: TransactionRecord, rules: dict[str, str], card_id: str) -> Transaction:
    return Transaction(
        id=record.id,
        date=record.date,
        amount=record.amount,
        currency=record.currency,
        raw_description=record.raw_description,
        merchant=record.merchant,
        category=_shown_category(record, rules),
        card_id=card_id,
        is_income=record.is_income,
        source=record.source,
        statement_id=record.statement_id,
    )


def _statement_cards(store: DataStore, saved: list[Card]) -> dict[str, str]:
    """Statement id -> the card its transactions are on."""
    return {s.id: _card_id(s.account, saved) for s in store.statements()}


# ---------------------------------------------------------------------------
# Returns and refunds
#
# Money back from a store is a refund, not income: the categorizer records it as a
# negative expense, so it shows as money in under the spending category it came back
# to. Each refund is linked to the purchase it returns, and spending counts only what
# was kept (net_spending). Must match src/lib/refunds.ts and linkRefunds there.

# A refund returns a purchase from the same merchant made at most this many days before it.
RETURN_DAYS = 120


def is_refund(t: Transaction) -> bool:
    """Money back for a purchase (a return, a rebate, a reversed charge): money in under a spending category."""
    return t.is_income and t.category not in INCOME_CATEGORIES


def net_spending(t: Transaction) -> float:
    """What a transaction adds to spending: a purchase less what came back for it. A refund the
    ledger couldn't link to its purchase comes off spending on its own date; linked refunds and
    income add nothing."""
    if not t.is_income:
        return t.amount - t.refunded_amount
    return -t.amount if is_refund(t) and t.refund_of is None else 0.0


def _merchant_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.casefold())


def link_refunds(txs: list[Transaction]) -> list[Transaction]:
    """Links each refund to the purchase it returns, oldest refund first.

    The purchase is from the same merchant, on or before the refund's date and at most
    RETURN_DAYS before it, with at least the refund's amount not yet returned. A whole return
    (exactly what is left of the purchase) wins, then one on the same card, then the latest.
    """
    purchases = [t for t in txs if not t.is_income]
    left = {p.id: p.amount for p in purchases}
    refund_of: dict[str, str] = {}
    refunds: dict[str, list[Transaction]] = {}
    for r in sorted((t for t in txs if is_refund(t)), key=lambda t: (t.date, t.id)):
        key, when = _merchant_key(r.merchant), date.fromisoformat(r.date)
        candidates = [
            p
            for p in purchases
            if _merchant_key(p.merchant) == key
            and p.date <= r.date
            and (when - date.fromisoformat(p.date)).days <= RETURN_DAYS
            and left[p.id] >= r.amount - 0.005
        ]
        if not candidates:
            continue
        best = max(candidates, key=lambda p: (abs(left[p.id] - r.amount) < 0.005, p.card_id == r.card_id, p.date, p.id))
        left[best.id] -= r.amount
        refund_of[r.id] = best.id
        refunds.setdefault(best.id, []).append(r)

    def linked(t: Transaction) -> Transaction:
        if t.id in refund_of:
            return t.model_copy(update={"refund_of": refund_of[t.id]})
        if back := refunds.get(t.id):
            return t.model_copy(
                update={"refunded_amount": round(sum(r.amount for r in back), 2), "refund_ids": [r.id for r in back]}
            )
        return t

    return [linked(t) for t in txs]


def card_by_number(store: DataStore, last4: str | None) -> Card | None:
    """The user's card whose number ends in `last4`, as printed on a receipt."""
    return next((c for c in store.cards() if last4 and c.last4 == last4), None)


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


def transactions(store: DataStore) -> list[Transaction]:
    """Every transaction in the user's ledger, newest first, with refunds linked to the purchases
    they return (link_refunds).

    Left out: rows another statement already brought (duplicate_of), and a receipt expense once a
    statement brings the same purchase (see find_match), so nothing is counted twice; that statement
    transaction shows under the receipt's category unless the user picked one for it.
    """
    rules = store.merchant_rules()
    statement_cards = _statement_cards(store, store.cards())
    records = store.transactions()
    ids = {r.id for r in records}
    shown = [r for r in records if not (r.duplicate_of and r.duplicate_of in ids)]
    # Statements newest first, each in its own order, as receipts are matched against them in this order.
    rank = {doc.id: i for i, doc in enumerate(store.files.documents())}
    from_statements = sorted(
        (r for r in shown if r.source == "statement"), key=lambda r: (rank.get(r.statement_id, len(rank)), r.position)
    )
    position = {r.id: r.position for r in records}

    result = [_as_transaction(r, rules, statement_cards.get(r.statement_id, DUMMY_CARD.id)) for r in from_statements]
    explicit = {r.id for r in from_statements if _is_explicit(r, rules)}
    claimed: dict[str, str] = {}  # statement transaction id -> the receipt expense it replaces
    for record in (r for r in shown if r.source == "receipt"):
        receipt = _as_transaction(record, rules, record.card_id or CASH_CARD_ID)
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
    linked = {s.transaction_id: s.id for s in store.scans() if s.transaction_id}

    def receipt_of(t: Transaction) -> str | None:
        return linked.get(t.id) or linked.get(claimed.get(t.id, ""))

    result = [t.model_copy(update={"receipt_id": rid}) if (rid := receipt_of(t)) else t for t in result]
    return sorted(link_refunds(result), key=lambda t: (t.date, position[t.id]), reverse=True)


def transaction(store: DataStore, tx_id: str) -> Transaction | None:
    """As transactions() shows it; one it leaves out (e.g. a receipt expense a statement has since brought) is still found by its id."""
    if found := next((t for t in transactions(store) if t.id == tx_id), None):
        return found
    if (record := store.transaction(tx_id)) is None:
        return None
    card_id = record.card_id or (
        _statement_cards(store, store.cards()).get(record.statement_id, DUMMY_CARD.id) if record.statement_id else CASH_CARD_ID
    )
    scan_id = next((s.id for s in store.scans() if s.transaction_id == tx_id), None)
    return _as_transaction(record, store.merchant_rules(), card_id).model_copy(update={"receipt_id": scan_id})


def is_receipt_id(tx_id: str) -> bool:
    return bool(_RECEIPT_ID.fullmatch(tx_id))


def recategorize(store: DataStore, tx_id: str, category: AppCategory, always_for_merchant: bool) -> CategoryUpdate | None:
    """Show a transaction under `category` in the app; its workbook category is kept for the budget workbook.

    With `always_for_merchant`, every transaction from the same merchant follows,
    including ones from statements added later. Returns None for an unknown id.
    """
    if (record := store.transaction(tx_id)) is None:
        return None
    if not always_for_merchant:
        store.update_transaction(tx_id, user_category=category)
        return CategoryUpdate(transaction=transaction(store, tx_id), affected_count=1)

    store.set_merchant_rule(record.merchant, category)
    same = [r for r in store.transactions() if r.merchant == record.merchant and r.duplicate_of is None]
    # Transactions picked one at a time before now follow the rule too.
    store.save_transactions([r.model_copy(update={"user_category": None}) for r in same if r.user_category is not None])
    return CategoryUpdate(transaction=transaction(store, tx_id), affected_count=len(same))


# ---------------------------------------------------------------------------
# Cards


def _from_input(card_id: str, data: CardInput) -> tuple[Card, list[RewardRule]]:
    card = Card(id=card_id, **data.model_dump(exclude={"rules"}))
    return card, [RewardRule(card_id=card_id, **r.model_dump()) for r in data.rules]


CardMatch = Literal["matched", "no_match", "no_account_number", "pending"]


def statement_account_last4(statement: StatementRecord) -> str | None:
    return (statement.account or {}).get("last4")


def _matching_card(account: dict | None, saved: list[Card]) -> Card | None:
    """The first card added whose account number ends in the statement's last 4 digits."""
    last4 = (account or {}).get("last4")
    return next((c for c in saved if last4 and c.account_last4 == last4), None)


def _card_id(account: dict | None, saved: list[Card]) -> str:
    """The card a statement's transactions are on: the matching card, else the placeholder."""
    return card.id if (card := _matching_card(account, saved)) else DUMMY_CARD.id


def statement_match(store: DataStore, statement: StatementRecord) -> tuple[CardMatch, str | None]:
    """How a categorized statement matches the user's cards, and the matching card's id.

    "pending": its account hasn't been read yet (statements categorized before that was recorded).
    """
    if statement.account is None:
        return "pending", None
    if not statement_account_last4(statement):
        return "no_account_number", None
    card = _matching_card(statement.account, store.cards())
    return ("matched", card.id) if card else ("no_match", None)


def cards(store: DataStore) -> list[Card]:
    """The user's cards, in the order added, plus the placeholder while any statement matches none of them."""
    saved = store.cards()
    categorized = [s for s in store.statements() if s.categorized]
    unmatched = not saved or any(_matching_card(s.account, saved) is None for s in categorized)
    return [*saved, DUMMY_CARD] if unmatched else saved


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


def statement_rewards(statement: StatementRecord) -> ReportedRewards | None:
    """The rewards summary printed on the statement; None when it prints none or it wasn't read yet."""
    if not (rewards := statement.rewards):
        return None
    lines = [ReportedRewardLine.model_validate(line) for line in rewards.get("lines") or []]
    return ReportedRewards(
        program=rewards.get("program"),
        unit=rewards.get("unit") or "dollars",
        earned=round(sum(line.amount for line in lines), 2),
        lines=lines,
    )


def statement_period(statement: StatementRecord) -> tuple[str | None, str | None]:
    return statement.period_start, statement.period_end


def reward_rules(store: DataStore) -> list[RewardRule]:
    return store.reward_rules()


def add_card(store: DataStore, data: CardInput) -> Card:
    card, card_rules = _from_input(f"card_{secrets.token_hex(6)}", data)
    store.save_card(card, card_rules)
    return card


def update_card(store: DataStore, card_id: str, data: CardInput) -> Card | None:
    """Replaces the card's details and reward rules; None for an unknown card (or the placeholder)."""
    if not any(c.id == card_id for c in store.cards()):
        return None
    card, card_rules = _from_input(card_id, data)
    store.save_card(card, card_rules)
    return card


def delete_card(store: DataStore, card_id: str) -> bool:
    """Removes the card and its reward rules; False for an unknown card (or the placeholder)."""
    return store.delete_card(card_id)


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


def add_receipt_expense(store: DataStore, data: ExpenseInput) -> Transaction:
    if data.card_id != CASH_CARD_ID and not any(c.id == data.card_id for c in store.cards()):
        raise UnknownCard("That card doesn't exist anymore.")
    tx_id = f"receipt_{secrets.token_hex(6)}"
    merchant = data.merchant.strip()
    store.save_transactions(
        [
            TransactionRecord(
                id=tx_id,
                source="receipt",
                date=data.date,
                amount=round(data.amount, 2),
                is_income=False,
                currency=data.currency,
                merchant=merchant,
                raw_description=f"Receipt from {merchant}",
                auto_category="Other",
                user_category=data.category,
                card_id=data.card_id,
                position=tx_id,
                created_at=_now(),
            )
        ]
    )
    if data.receipt_id:
        attach_receipt(store, data.receipt_id, tx_id)
    return transaction(store, tx_id)


def delete_receipt_expense(store: DataStore, tx_id: str) -> bool:
    """Removes the expense and its receipt; False when there is no such receipt expense."""
    record = store.transaction(tx_id)
    if record is None or record.source != "receipt":
        return False
    store.delete_transactions([tx_id])
    for scan in store.scans():
        if scan.transaction_id == tx_id:
            store.delete_scan(scan.id)
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


def save_scan(store: DataStore, read: dict, image_jpeg: bytes) -> str:
    """Keeps a new scan, for now without a transaction; returns its id."""
    now = datetime.now()
    for old in store.scans():
        if not old.transaction_id and (now - datetime.fromisoformat(old.scanned_at)).total_seconds() > UNSAVED_SCAN_HOURS * 3600:
            store.delete_scan(old.id)
    scan_id = f"scan_{secrets.token_hex(6)}"
    store.save_scan(ScanRecord(id=scan_id, scanned_at=now.isoformat(timespec="seconds"), **read), image_jpeg)
    return scan_id


def attach_receipt(store: DataStore, scan_id: str, tx_id: str) -> Transaction | None:
    """Saves the scan with the transaction, replacing a receipt it had; None for an unknown scan or transaction."""
    if not is_scan_id(scan_id) or transaction(store, tx_id) is None or (scan := store.scan(scan_id)) is None:
        return None
    for other in store.scans():
        if other.transaction_id == tx_id and other.id != scan_id:
            store.delete_scan(other.id)
    store.save_scan(scan.model_copy(update={"transaction_id": tx_id}))
    return transaction(store, tx_id)


def delete_receipt(store: DataStore, scan_id: str) -> bool:
    """Deletes a scan and its photo; the transaction stays. False for an unknown scan."""
    if not is_scan_id(scan_id) or store.scan(scan_id) is None:
        return False
    store.delete_scan(scan_id)
    return True
