"""The records the backend stores for each user, independent of where they are stored.

A DataStore (datastore.py) keeps these per user; ledger.py, planning.py and
assistant.py turn them into what the app sees. Models the app sends or receives
use camelCase in JSON (AppModel) and mirror src/types.ts.
"""

from datetime import date
from typing import Annotated, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

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


class AppModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# Card and account numbers are only ever kept as their last 4 digits.
Last4 = Annotated[str, Field(pattern=r"^\d{4}$")]


# ---------------------------------------------------------------------------
# Cards


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


# ---------------------------------------------------------------------------
# Budgets and the savings goal


class Budget(AppModel):
    category: ExpenseCategory
    monthly_limit: float = Field(gt=0, le=100_000)


class SavingsGoal(AppModel):
    name: str = Field(min_length=1, max_length=60)
    target_amount: float = Field(gt=0, le=10_000_000)
    start_date: date  # the day it was set; saving counts from here
    target_date: date

    @model_validator(mode="after")
    def _ends_after_start(self) -> "SavingsGoal":
        if self.target_date <= self.start_date:
            raise ValueError("The target date must be after the day the goal starts.")
        return self


# ---------------------------------------------------------------------------
# Assistant chat

Tone = Literal["primary", "income", "expense", "warning"]


class ChatSummary(AppModel):
    value: str
    label: str
    tone: Tone | None = None


class ChatMessage(AppModel):
    """ChatMessage in src/types.ts."""

    id: str
    role: Literal["user", "assistant"]
    text: str
    created_at: str
    summary: ChatSummary | None = None


# ---------------------------------------------------------------------------
# Statements and transactions

JobStatus = Literal["queued", "running", "stopped", "done"]


class StatementRecord(BaseModel):
    """The app's state for an uploaded statement. Its files (the PDF, page images,
    transcriptions and the categorizer's budget.json) are in the user's Library under the same id."""

    id: str
    # Processing, kept so a restart neither forgets a queued statement nor why one stopped.
    status: JobStatus = "stopped"
    stage: str | None = None  # what is happening now, while queued or running
    message: str | None = None  # why the last run stopped short
    updated_at: str | None = None
    categorized: bool = False
    row_count: int | None = None  # expense and income rows the categorizer found
    duplicate_count: int = 0  # of those, rows another statement already brought
    # {"type", "institution", "name", "last4"} as read from its header; None until read.
    account: dict | None = None
    # The period and printed rewards summary; summary_read is False until they have been read.
    summary_read: bool = False
    period_start: str | None = None
    period_end: str | None = None
    rewards: dict | None = None  # categorize.schemas.StatementRewards as a dict; None if it prints none


class TransactionRecord(BaseModel):
    """One transaction in the ledger, with an id that never changes.

    A statement transaction's card isn't stored: it is the card whose account number
    matches its statement's, worked out on every read so editing a card re-links at once.
    Its category is the one picked in the app (user_category), else the app's rule for its
    merchant, else auto_category, all decided on read so rules apply to every statement.
    """

    id: str
    source: Literal["statement", "receipt"]
    date: str  # YYYY-MM-DD
    amount: float  # always positive; is_income gives the direction
    is_income: bool
    currency: str
    merchant: str
    raw_description: str
    auto_category: AppCategory  # from the categorizer's workbook category (statements); "Other" for receipts
    user_category: AppCategory | None = None
    card_id: str | None = None  # receipt expenses only: a card id or "cash"
    statement_id: str | None = None
    # Orders transactions within a day: the statement row's place, or the id for receipts.
    position: str
    # What makes a statement transaction unique across statements (see ledger.dedup_key).
    dedup_key: str | None = None
    duplicate_of: str | None = None  # the transaction an earlier statement already brought; hidden
    workbook_category: str | None = None  # the categorizer's own category, kept for the record
    created_at: str


class ScanRecord(BaseModel):
    """A scanned receipt: what was read from it. Its photo is stored next to it."""

    id: str
    scanned_at: str
    merchant: str
    date: str | None
    subtotal: float | None
    tax: float | None
    tax_label: str | None
    total: float
    currency: str
    items: list[dict]
    card_last4: str | None
    transaction_id: str | None = None


# ---------------------------------------------------------------------------
# Long-term memory

MemoryKind = Literal["fact", "preference", "pattern", "goal"]


class Memory(BaseModel):
    """Something the assistant should keep in mind across conversations."""

    id: str
    text: str
    kind: MemoryKind = "fact"
    created_at: str
    source: str | None = None  # e.g. the chat message it came from
