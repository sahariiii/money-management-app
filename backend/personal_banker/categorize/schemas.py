"""Structured outputs for the two categorization calls.

The extraction call lists the statement's transactions without judging them.
The decision call sees only the rows no vendor rule matched; its category
fields are built per workbook so structured outputs can only return names that
exist in the user's 'Category Setup' tab.
"""

from typing import Literal

from pydantic import BaseModel, Field

from .workbook import BudgetSetup


class StatementTransaction(BaseModel):
    date: str = Field(description="Transaction date as YYYY-MM-DD.")
    statement_description: str = Field(
        description="The description exactly as printed, with wrapped lines joined by a space."
    )
    amount: float = Field(description="The amount as a positive number.")
    direction: Literal["money_out", "money_in"] = Field(
        description="money_out for purchases, charges and withdrawals; money_in for deposits, refunds and "
        "payments received."
    )


class OtherLine(BaseModel):
    date: str | None = Field(description="YYYY-MM-DD, or null if not printed.")
    statement_description: str = Field(description="The line exactly as printed on the statement.")
    amount: float | None
    reason: str = Field(description="What the line is, e.g. 'closing balance' or 'subtotal'.")


class ExtractedStatement(BaseModel):
    account_type: Literal["bank_account", "credit_card", "other"]
    institution: str | None = Field(description="The bank or card issuer as printed, e.g. 'RBC Royal Bank'; null if not printed.")
    account_name: str | None = Field(
        description="The account or card product as printed, e.g. 'RBC Advantage Banking' or 'Visa Infinite'. "
        "Never the account or card number. Null if not printed."
    )
    period_start: str | None = Field(description="First day of the statement period as YYYY-MM-DD; null if not printed.")
    period_end: str | None = Field(description="Last day of the statement period as YYYY-MM-DD; null if not printed.")
    transactions: list[StatementTransaction] = Field(description="Every transaction row, in the order printed.")
    other_lines: list[OtherLine] = Field(
        description="Rows in the transaction tables that are not transactions: opening/closing or carried-forward "
        "balances, subtotals and summary lines."
    )


class SkipDecision(BaseModel):
    row: int
    reason: str = Field(description="Why it is neither an expense nor income, e.g. 'payment to this card'.")


def build_decision_model(setup: BudgetSetup) -> type[BaseModel]:
    ExpenseCategory = Literal[tuple(c.name for c in setup.expense_categories)]
    IncomeCategory = Literal[tuple(c.name for c in setup.income_categories)]

    class ExpenseDecision(BaseModel):
        row: int
        vendor: str = Field(description="Short, clean store / vendor name in the style of the user's past entries.")
        category: ExpenseCategory  # type: ignore[valid-type]
        likely_shared: bool = Field(
            description="True if the user's past entries suggest they split this kind of purchase 50/50."
        )
        review_note: str | None = Field(description="Why the vendor or category is uncertain; null if confident.")

    class IncomeDecision(BaseModel):
        row: int
        source: str = Field(description="Short, clean source name in the style of the user's past entries.")
        category: IncomeCategory  # type: ignore[valid-type]
        review_note: str | None = Field(description="Why the source or category is uncertain; null if confident.")

    class Decisions(BaseModel):
        expenses: list[ExpenseDecision] = Field(description="Rows that are expenses, including refunds.")
        income: list[IncomeDecision] = Field(description="Rows that are income.")
        skipped: list[SkipDecision] = Field(
            description="Rows that are neither: card payments, transfers between the user's own accounts, and similar."
        )

    return Decisions
