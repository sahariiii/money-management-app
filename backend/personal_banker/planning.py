"""The mobile app's monthly budgets per category and its one savings goal, kept in library/plan.json.

The app suggests budgets that reach the goal (src/lib/savings-plan.ts) and saves the
goal and those budgets together. Progress toward the goal is money in minus money
out since the day it was set, so it is worked out from the ledger whenever it is
read (goal_progress, the same as goalStatus in src/lib/api.ts). Models mirror
src/types.ts.
"""

import threading
from datetime import date

from pydantic import Field, model_validator

from .ledger import AppModel, ExpenseCategory, Transaction
from .store import Library

DAYS_PER_MONTH = 365.25 / 12

_write_lock = threading.Lock()


class Budget(AppModel):
    category: ExpenseCategory
    monthly_limit: float = Field(gt=0, le=100_000)


class BudgetLimit(AppModel):
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


class GoalPlan(AppModel):
    """What the app's savings goal screen saves: the goal, and the budgets that replace all of the current ones."""

    goal: SavingsGoal
    budgets: list[Budget]

    @model_validator(mode="after")
    def _one_budget_per_category(self) -> "GoalPlan":
        categories = [b.category for b in self.budgets]
        if len(categories) != len(set(categories)):
            raise ValueError("Each category can only have one budget.")
        return self


def _read(library: Library) -> tuple[list[Budget], SavingsGoal | None]:
    data = library.plan()
    saved_goal = data.get("goal")
    return (
        [Budget.model_validate(b) for b in data.get("budgets", [])],
        SavingsGoal.model_validate(saved_goal) if saved_goal else None,
    )


def _save(library: Library, budgets_: list[Budget], goal_: SavingsGoal | None) -> None:
    library.save_plan(
        {
            "budgets": [b.model_dump(mode="json") for b in budgets_],
            "goal": goal_.model_dump(mode="json") if goal_ else None,
        }
    )


def budgets(library: Library) -> list[Budget]:
    return _read(library)[0]


def set_budget(library: Library, category: ExpenseCategory, monthly_limit: float) -> Budget:
    """Creates or changes the monthly limit for a category."""
    budget = Budget(category=category, monthly_limit=round(monthly_limit, 2))
    with _write_lock:
        saved, saved_goal = _read(library)
        if any(b.category == category for b in saved):
            saved = [budget if b.category == category else b for b in saved]
        else:
            saved = [*saved, budget]
        _save(library, saved, saved_goal)
    return budget


def goal(library: Library) -> SavingsGoal | None:
    return _read(library)[1]


def save_goal(library: Library, plan: GoalPlan) -> SavingsGoal:
    """Saves the goal and replaces every budget with the plan's."""
    with _write_lock:
        _save(library, plan.budgets, plan.goal)
    return plan.goal


def delete_goal(library: Library) -> bool:
    """Removes the goal and keeps the budgets; False when there was none."""
    with _write_lock:
        saved, saved_goal = _read(library)
        if saved_goal is None:
            return False
        _save(library, saved, None)
    return True


def goal_progress(goal_: SavingsGoal, txs: list[Transaction], today: date) -> dict:
    """How the goal is going: money in minus money out from its start through the latest transaction.

    Statements arrive after the fact, so progress is measured at the latest transaction (as_of),
    against a steady pace from nothing at the start to the whole amount on the target date.
    """
    start, target = goal_.start_date, goal_.target_date
    end = min(today, target).isoformat()
    rows = [t for t in txs if start.isoformat() <= t.date <= end]
    as_of = date.fromisoformat(max((t.date for t in rows), default=start.isoformat()))
    saved = sum(t.amount if t.is_income else -t.amount for t in rows)
    pace = min(1.0, max(0.0, (as_of - start).days / (target - start).days))
    expected = goal_.target_amount * pace
    left = max(0.0, goal_.target_amount - saved)
    months_left = (target - as_of).days / DAYS_PER_MONTH
    return {
        "name": goal_.name,
        "target_amount": goal_.target_amount,
        "start_date": start.isoformat(),
        "target_date": target.isoformat(),
        "saved": round(saved, 2),
        "counted_through": as_of.isoformat(),
        "transactions_counted": len(rows),
        "expected_by_then_at_a_steady_pace": round(expected, 2),
        "on_track": saved >= expected - 0.005,
        "monthly_saving_needed_from_now": round(left / months_left if months_left > 0 else left, 2),
        "days_until_target_date": (target - today).days,
    }
