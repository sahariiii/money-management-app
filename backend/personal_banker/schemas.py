"""Structured outputs exchanged between the pipeline's agents.

Amounts are floats because they travel through JSON-schema structured outputs;
`reconcile` converts them to Decimal before doing any arithmetic.
"""

from typing import Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Pass 1: layout
# ---------------------------------------------------------------------------

ColumnRole = Literal[
    "date",
    "value_date",
    "description",
    "reference",
    "debit",
    "credit",
    "amount",
    "balance",
    "other",
]


class ColumnSpec(BaseModel):
    header: str = Field(description="Column header exactly as printed on the statement.")
    role: ColumnRole = Field(description="What the column holds.")


class TransactionTable(BaseModel):
    pages: list[int] = Field(description="1-indexed pages this table appears on.")
    columns: list[ColumnSpec] = Field(description="Columns in left-to-right order.")
    date_format: str = Field(description="Date format as printed, e.g. 'DD/MM/YYYY' or 'DD Mon'.")
    amount_convention: Literal["separate_debit_credit", "signed_amount", "amount_with_dr_cr_marker"]
    multiline_descriptions: bool = Field(
        description="True if a single transaction's description can wrap onto following lines."
    )
    row_order: Literal["oldest_first", "newest_first"]
    notes: str = Field(description="Anything unusual: carried-forward rows, subtotals, FX lines, etc.")


class StatementLayout(BaseModel):
    bank_name: str | None
    document_type: Literal["bank_account", "credit_card", "other"]
    page_count: int
    currency: str | None = Field(description="ISO 4217 code, e.g. 'GBP'.")
    statement_period_location: str = Field(description="Where the statement period is printed.")
    balance_summary_location: str = Field(
        description="Where opening/closing balances are printed, or 'not present'."
    )
    transaction_tables: list[TransactionTable]
    sections_to_ignore: list[str] = Field(
        description="Regions that look like transactions but are not (adverts, summaries, interest tables)."
    )
    notes: str


# ---------------------------------------------------------------------------
# Pass 2: text extraction
# ---------------------------------------------------------------------------


class Transaction(BaseModel):
    date: str = Field(description="Transaction date as YYYY-MM-DD.")
    description: str = Field(description="Full description, with wrapped lines joined by a space.")
    amount: float = Field(
        description="Signed amount: negative for money out / charges, positive for money in / payments."
    )
    balance: float | None = Field(description="Running balance printed on this row, if any.")
    reference: str | None
    page: int = Field(description="1-indexed page the row appears on.")


class StatementData(BaseModel):
    account_holder: str | None
    account_number_last4: str | None = Field(description="Only the last 4 digits of the account number.")
    currency: str | None = Field(description="ISO 4217 code.")
    period_start: str | None = Field(description="YYYY-MM-DD.")
    period_end: str | None = Field(description="YYYY-MM-DD.")
    opening_balance: float | None
    closing_balance: float | None
    transactions: list[Transaction] = Field(description="Every transaction, in the order printed.")
