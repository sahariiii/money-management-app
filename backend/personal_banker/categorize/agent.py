"""The categorization agent: statement Markdown in, budget rows out.

Three steps: an extraction call lists the transactions, the workbook's vendor
rules categorize the ones they know, and a second call decides only the rest.
Dates, amounts and descriptions always come from the extraction, so neither
the rules nor the second call can change them.
"""

from dataclasses import dataclass, field
from datetime import date, datetime

import anthropic
import braintrust
from pydantic import BaseModel

from ..llm import CallResult, run_structured
from .rules import match_rule
from .schemas import ExtractedStatement, StatementTransaction, build_decision_model
from .workbook import BudgetSetup, Category, PastEntry, VendorRule

EXTRACTION_INSTRUCTIONS = """\
You read bank and credit-card statements for a personal budget. Each request \
gives you one statement, transcribed to Markdown from page images. List its \
transactions; a later step categorizes them, so don't judge what they are for.

- List every transaction row in the order printed, including card payments, \
transfers, fees and interest.
- Give each row's amount as a positive number and its direction. Work out the \
direction from the statement itself (debit vs credit columns, signs, CR/DR \
markers, and whether it is a bank account or a credit card).
- Copy dates and amounts exactly; only reformat dates to YYYY-MM-DD, taking \
the year from the statement period when a row omits it.
- Copy each description as printed, joining wrapped lines with a space.
- Put opening/closing or carried-forward balances, subtotals and summary lines \
in other_lines, not in transactions, so nothing disappears silently.
- Also give the bank, the account or card name and the statement period as \
printed in the statement header (e.g. 'From July 23, 2026 to August 21, 2026')."""

DECISION_INSTRUCTIONS = """\
You sort bank and credit-card transactions into a personal budget. Each \
request lists transactions from one statement that the user's own vendor \
rules didn't recognise, one per line as \
'row | date | direction | amount | statement description'. Return a decision \
for every row, as an expense, as income, or as skipped, using its row number.

How to decide:
- Expenses: purchases, bills, subscriptions, fees and interest charged. A \
money_in row that refunds an earlier purchase is an expense in the category of \
what was refunded; it is recorded as a negative amount.
- Income: pay, benefits, rental income, interest earned and other money \
received from someone else.
- Skipped: money moving between the user's own accounts and payments made to \
this credit card. Give the reason.
- Name vendors the way the user does in their past entries (for example, \
reuse a name they already use for the same merchant), and pick the category \
they would pick. Use 'Other' only when nothing else fits, and say why in \
review_note.
- Set likely_shared when their past entries show halved amounts for that kind \
of purchase or merchant. The user halves shared costs themselves."""


def _category_lines(categories: list[Category]) -> str:
    return "\n".join(f"- {c.name}" + (f" ({c.note})" if c.note else "") for c in categories)


def _entry_lines(entries: list[PastEntry]) -> str:
    return "\n".join(
        f"{e.date:%Y-%m-%d} | {e.vendor} | {e.amount:g} | {e.category}" + (f" | {e.note}" if e.note else "")
        for e in entries
    )


def budget_context(setup: BudgetSetup) -> str:
    return f"""\
<expense_categories>
{_category_lines(setup.expense_categories)}
</expense_categories>

<income_categories>
{_category_lines(setup.income_categories)}
</income_categories>

<past_expenses note="date | vendor | amount the user recorded | category | note">
{_entry_lines(setup.past_expenses)}
</past_expenses>

<past_income note="date | source | amount | category | note">
{_entry_lines(setup.past_income)}
</past_income>"""


@dataclass
class CategorizationResult:
    """Rows in budget.json form, plus the calls that produced them."""

    expenses: list[dict] = field(default_factory=list)
    income: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    calls: list[CallResult] = field(default_factory=list)
    rule_matches: int = 0


def _expense(t: StatementTransaction, vendor: str, category: str, shared: bool, note: str | None, by: str) -> dict:
    # A money-in row at a merchant is a refund, which the budget records as a negative expense.
    amount = t.amount if t.direction == "money_out" else -t.amount
    return {"date": t.date, "vendor": vendor, "amount": amount, "category": category, "likely_shared": shared,
            "statement_description": t.statement_description, "review_note": note, "categorized_by": by}


def _income(t: StatementTransaction, source: str, category: str, note: str | None, by: str) -> dict:
    amount = t.amount if t.direction == "money_in" else -t.amount
    if t.direction == "money_out":
        note = note or "Money out recorded as income; check it."
    return {"date": t.date, "source": source, "amount": amount, "category": category,
            "statement_description": t.statement_description, "review_note": note, "categorized_by": by}


def _skipped(t: StatementTransaction, reason: str, by: str) -> dict:
    return {"date": t.date, "statement_description": t.statement_description, "amount": t.amount,
            "reason": reason, "categorized_by": by}


def _apply_rule(t: StatementTransaction, rule: VendorRule) -> tuple[str, dict] | None:
    """(kind, row) for a rule match, or None when the rule doesn't fit the row's direction."""
    if rule.kind == "skip":
        return "skipped", _skipped(t, rule.note or f"Vendor rule '{rule.match}'", "rule")
    if rule.kind == "income":
        # Money out at an income source isn't something a rule should guess about.
        return ("income", _income(t, rule.vendor, rule.category, rule.note, "rule")) if t.direction == "money_in" else None
    return "expenses", _expense(t, rule.vendor, rule.category, rule.shared, None, "rule")


@braintrust.traced(notrace_io=True)
def extract_transactions(client: anthropic.Anthropic, statement_markdown: str) -> CallResult[ExtractedStatement]:
    content = [
        {
            "type": "text",
            "text": f"<statement>\n{statement_markdown}\n</statement>\n\nList every transaction on this statement.",
        }
    ]
    return run_structured(client, EXTRACTION_INSTRUCTIONS, content, ExtractedStatement)


@braintrust.traced(notrace_io=True)
def decide_unknowns(
    client: anthropic.Anthropic,
    account_type: str,
    rows: dict[int, StatementTransaction],
    setup: BudgetSetup,
) -> CallResult[BaseModel]:
    system = [
        {"type": "text", "text": DECISION_INSTRUCTIONS},
        # The categories and history are the same for every statement, so cache them.
        {"type": "text", "text": budget_context(setup), "cache_control": {"type": "ephemeral"}},
    ]
    lines = "\n".join(
        f"{i} | {t.date} | {t.direction} | {t.amount:g} | {t.statement_description}" for i, t in rows.items()
    )
    content = [
        {
            "type": "text",
            "text": f"Account type: {account_type}\n\n<transactions>\n{lines}\n</transactions>\n\n"
            "Decide every row.",
        }
    ]
    return run_structured(client, system, content, build_decision_model(setup))


@braintrust.traced(notrace_io=True)
def categorize_statement(
    client: anthropic.Anthropic, statement_markdown: str, setup: BudgetSetup
) -> CategorizationResult:
    extraction = extract_transactions(client, statement_markdown)
    statement = extraction.output
    result = CategorizationResult(calls=[extraction])
    # (row, kind, budget row), sorted into statement order at the end.
    placed: list[tuple[int, str, dict]] = [
        (-1, "skipped", {**line.model_dump(), "categorized_by": "extraction"}) for line in statement.other_lines
    ]

    unknown: dict[int, StatementTransaction] = {}
    for i, t in enumerate(statement.transactions):
        rule = match_rule(t.statement_description, setup.rules)
        if rule and (applied := _apply_rule(t, rule)):
            placed.append((i, *applied))
        else:
            unknown[i] = t
    result.rule_matches = len(statement.transactions) - len(unknown)

    if unknown:
        decision = decide_unknowns(client, statement.account_type, unknown, setup)
        result.calls.append(decision)
        decided = decision.output
        for d in decided.expenses:
            if (t := unknown.pop(d.row, None)) is not None:
                placed.append((d.row, "expenses", _expense(t, d.vendor, d.category, d.likely_shared, d.review_note, "agent")))
        for d in decided.income:
            if (t := unknown.pop(d.row, None)) is not None:
                placed.append((d.row, "income", _income(t, d.source, d.category, d.review_note, "agent")))
        for d in decided.skipped:
            if (t := unknown.pop(d.row, None)) is not None:
                placed.append((d.row, "skipped", _skipped(t, d.reason, "agent")))
        # Rows the agent left out are kept visible rather than dropped.
        for i, t in unknown.items():
            placed.append((i, "skipped", _skipped(t, "Not categorized by the agent; add it by hand.", "agent")))

    for _, kind, row in sorted(placed, key=lambda p: p[0]):
        getattr(result, kind).append(row)

    braintrust.current_span().log(
        output={"expenses": len(result.expenses), "income": len(result.income), "skipped": len(result.skipped)},
        metadata={
            "transactions": len(statement.transactions),
            "rule_matches": result.rule_matches,
            "agent_rows": len(statement.transactions) - result.rule_matches,
        },
    )
    return result


MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def statement_title(statement: ExtractedStatement) -> str | None:
    """A short name for the statement: the month and year its period ends in, e.g. 'Aug2026'
    for July 23 - August 21, 2026 (the month a statement is issued for).

    Uses the printed period end, else the last transaction date; None when there is neither.
    """
    end = statement.period_end or max((t.date for t in statement.transactions), default=None)
    try:
        when = date.fromisoformat(end) if end else None
    except ValueError:
        return None
    return f"{MONTHS[when.month - 1]}{when.year}" if when else None


def budget_record(result: CategorizationResult, workbook_name: str) -> dict:
    """Plain rows plus provenance, as stored in the library's budget.json.

    Rows are kept as plain dicts rather than a per-workbook model, so they
    still load after the user renames or removes a category. `title` names the
    statement after its month, e.g. 'Aug2026'; the library renames the document to it.
    """
    return {
        "title": statement_title(result.calls[0].output),
        "workbook": workbook_name,
        "categorized_at": datetime.now().isoformat(timespec="seconds"),
        "model": result.calls[0].model,
        "input_tokens": sum(c.input_tokens for c in result.calls),
        "output_tokens": sum(c.output_tokens for c in result.calls),
        "rule_matches": result.rule_matches,
        "edited": False,
        "expenses": result.expenses,
        "income": result.income,
        "skipped": result.skipped,
    }
