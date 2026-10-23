"""Deterministic checks on extracted data. No LLM: arithmetic either adds up or it doesn't."""

from dataclasses import dataclass
from decimal import Decimal

from .schemas import StatementData, StatementLayout

TOLERANCE = Decimal("0.01")


def _d(value: float) -> Decimal:
    return Decimal(str(value))


@dataclass
class Reconciliation:
    money_in: Decimal
    money_out: Decimal
    net: Decimal
    expected_closing: Decimal | None
    closing_matches: bool | None
    # Indices into StatementData.transactions whose printed balance doesn't follow.
    running_balance_breaks: list[int]

    @property
    def ok(self) -> bool:
        return self.closing_matches is not False and not self.running_balance_breaks


def _running_breaks(data: StatementData, order: list[int], sign: int) -> list[int]:
    breaks: list[int] = []
    last_balance: Decimal | None = None
    pending = Decimal(0)
    for i in order:
        tx = data.transactions[i]
        pending += _d(tx.amount)
        if tx.balance is None:
            continue
        balance = _d(tx.balance)
        if last_balance is not None and abs(last_balance + sign * pending - balance) > TOLERANCE:
            breaks.append(i)
        last_balance, pending = balance, Decimal(0)
    return breaks


def reconcile(data: StatementData, layout: StatementLayout) -> Reconciliation:
    amounts = [_d(tx.amount) for tx in data.transactions]
    money_in = sum((a for a in amounts if a > 0), Decimal(0))
    money_out = sum((a for a in amounts if a < 0), Decimal(0))
    net = money_in + money_out

    # A credit-card balance is the amount owed, so charges (negative) increase it.
    sign = -1 if layout.document_type == "credit_card" else 1

    expected_closing = closing_matches = None
    if data.opening_balance is not None:
        expected_closing = _d(data.opening_balance) + sign * net
        if data.closing_balance is not None:
            closing_matches = abs(expected_closing - _d(data.closing_balance)) <= TOLERANCE

    # Check in both directions and keep the better fit; the layout's row_order
    # is a model judgement and tables can differ between pages.
    forward = list(range(len(data.transactions)))
    breaks = min(
        _running_breaks(data, forward, sign),
        _running_breaks(data, forward[::-1], sign),
        key=len,
    )

    return Reconciliation(money_in, money_out, net, expected_closing, closing_matches, breaks)
