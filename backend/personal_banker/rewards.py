"""Cashback: what a card's statements say it earned, and the app's own estimate where none says.

A statement's printed rewards summary is what the bank actually paid, so it is the source of
truth. The estimate covers the rest (purchases not on a statement yet, or on one that prints no
summary) from the card's reward rules and the app's categories. It follows rewardFor in
src/lib/api.ts, which the Cards tab uses; keep the two in step.
"""

from collections import defaultdict
from dataclasses import dataclass, field

from . import ledger
from .ledger import INCOME_CATEGORIES, RewardRule, Transaction
from .store import Library

# Rent can't realistically go on a card, and fees and interest are charged by the card itself.
NO_REWARDS = {"Housing", "Fees & interest", *INCOME_CATEGORIES}


def is_refund(t: Transaction) -> bool:
    """Money back for a purchase: issuers take back the cashback it earned."""
    return t.is_income and t.category not in INCOME_CATEGORIES


def earns_rewards(t: Transaction) -> bool:
    return (not t.is_income or is_refund(t)) and t.category not in NO_REWARDS


def rule_for(rules: list[RewardRule], card_id: str, category: str) -> RewardRule | None:
    own = [r for r in rules if r.card_id == card_id]
    return next((r for r in own if r.category == category), None) or next((r for r in own if r.category == "*"), None)


@dataclass
class Estimate:
    earned: float = 0.0
    spent: float = 0.0  # purchases minus refunds that earn rewards
    by_rate: dict[float, list[float]] = field(default_factory=lambda: defaultdict(lambda: [0.0, 0.0]))  # rate -> [spent, earned]
    first_date: str | None = None
    last_date: str | None = None

    def as_dict(self) -> dict:
        return {
            "estimated_cashback": round(self.earned, 2),
            "spend_counted": round(self.spent, 2),
            "first_transaction": self.first_date,
            "last_transaction": self.last_date,
            "by_rate": [
                {"rate_percent": rate, "spend": round(s, 2), "cashback": round(e, 2)}
                for rate, (s, e) in sorted(self.by_rate.items(), reverse=True)
                if rate > 0
            ],
        }


def estimate(txs: list[Transaction], rules: list[RewardRule], card_id: str) -> Estimate:
    """The cashback the card's rules give `txs` (the card's own transactions). Caps are monthly
    spend limits per rule; spend past a cap earns the card's "*" rate."""
    result = Estimate()
    used: dict[tuple[str, str], float] = defaultdict(float)  # (rule category, month) -> spend so far
    base = next((r for r in rules if r.card_id == card_id and r.category == "*"), None)
    for t in sorted((t for t in txs if earns_rewards(t)), key=lambda t: t.date):
        rule = rule_for(rules, card_id, t.category)
        if rule is None:
            continue
        if is_refund(t):
            earned, spent = -t.amount * rule.rate_percent / 100, -t.amount
        else:
            eligible = t.amount
            if rule.cap is not None:
                key = (rule.category, t.date[:7])
                eligible = max(0.0, min(t.amount, rule.cap - used[key]))
                used[key] += t.amount
            fallback = base.rate_percent if base and base is not rule else 0
            earned, spent = (eligible * rule.rate_percent + (t.amount - eligible) * fallback) / 100, t.amount
        result.earned += earned
        result.spent += spent
        result.by_rate[rule.rate_percent][0] += spent
        result.by_rate[rule.rate_percent][1] += earned
        result.first_date = min(result.first_date or t.date, t.date)
        result.last_date = max(result.last_date or t.date, t.date)
    return result


@dataclass(frozen=True)
class StatementRewards:
    statement_id: str
    name: str
    card_id: str
    period_start: str | None
    period_end: str | None
    reported: ledger.ReportedRewards | None


def statement_rewards(library: Library) -> list[StatementRewards]:
    """Every categorized statement on one of the user's cards, with what it says it earned (if it prints it)."""
    result = []
    for doc in library.documents():
        if (budget := library.budget(doc)) is None:
            continue
        match, card_id = ledger.statement_match(library, budget)
        if match != "matched" or card_id is None:
            continue
        start, end = ledger.statement_period(budget)
        result.append(StatementRewards(doc.id, doc.name.removesuffix(".pdf"), card_id, start, end, ledger.statement_rewards(budget)))
    return result
