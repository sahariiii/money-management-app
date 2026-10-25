"""Budget categorization: transcribed statement Markdown -> expense / income rows for the budget workbook."""

import os

from .agent import (
    CategorizationResult,
    account_record,
    budget_record,
    categorize_statement,
    identify_account,
    read_summary,
    summary_record,
)
from .export import to_xlsx
from .workbook import BudgetSetup, Category, PastEntry, RulesError, load_budget_setup

# Optional: without a workbook here, statements are categorized into the app's own categories.
DEFAULT_WORKBOOK = os.environ.get("PERSONAL_BANKER_WORKBOOK", "data/BudgetTracking_Setareh.xlsx")

__all__ = [
    "DEFAULT_WORKBOOK",
    "BudgetSetup",
    "Category",
    "PastEntry",
    "CategorizationResult",
    "RulesError",
    "account_record",
    "budget_record",
    "categorize_statement",
    "identify_account",
    "load_budget_setup",
    "read_summary",
    "summary_record",
    "to_xlsx",
]
