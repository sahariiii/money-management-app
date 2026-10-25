// Suggests monthly budgets that save an amount by a date, from recent income and spending
// (getSpendingBaseline in api.ts). Pure, so the savings goal screen can re-plan on every keystroke.

import { daysFrom } from '@/lib/dates';
import type { Category, ISODate, PlanCategory, SavingsPlan, SpendingBaseline } from '@/types';

export const DAYS_PER_MONTH = 365.25 / 12;

/** Months (with a fraction) from one date to another. */
export const monthsBetween = (from: ISODate, to: ISODate) => daysFrom(from, to) / DAYS_PER_MONTH;

/**
 * Where the plan finds the money, in order: discretionary spending first, by up to half, then
 * everyday needs by up to 15%. Everything else (housing, car, phone, utilities, fees) is a fixed
 * cost the plan leaves alone.
 */
const CUT_TIERS: { categories: Category[]; maxCut: number }[] = [
  { categories: ['Food', 'Shopping', 'Entertainment', 'Subscriptions', 'Other'], maxCut: 0.5 },
  { categories: ['Groceries', 'Transport', 'Gas & EV charging', 'Health'], maxCut: 0.15 },
];

export const isFixedCost = (category: Category) => !CUT_TIERS.some((t) => t.categories.includes(category));

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Monthly budgets that save `amount` between `from` and `to`. Each category starts at its average;
 * when that doesn't save enough, the plan cuts each tier evenly (the same share of every category
 * in it) before moving on to the next. Targets are whole dollars, rounded down, so they save at
 * least what's needed.
 */
export function planSavings(baseline: SpendingBaseline, { amount, from, to }: { amount: number; from: ISODate; to: ISODate }): SavingsPlan {
  const months = monthsBetween(from, to);
  const monthlyNeeded = months > 0 ? amount / months : amount;
  const categories: PlanCategory[] = baseline.categories.map((c) => {
    const average = Math.round(c.average);
    return { category: c.category, average, target: average, fixed: isFixedCost(c.category) };
  });

  let gap = monthlyNeeded - (baseline.monthlyIncome - sum(categories.map((c) => c.average)));
  for (const tier of CUT_TIERS) {
    if (gap <= 0) break;
    const rows = categories.filter((c) => tier.categories.includes(c.category));
    const total = sum(rows.map((c) => c.average));
    if (total === 0) continue;
    const share = Math.min(gap / total, tier.maxCut);
    for (const c of rows) {
      // The epsilon keeps 300 * 0.1 (30.000000000000004) from rounding up to a $31 cut.
      c.target = c.average - Math.min(c.average, Math.ceil(c.average * share - 1e-6));
      gap -= c.average - c.target;
    }
  }

  const saving = baseline.monthlyIncome - sum(categories.map((c) => c.target));
  return {
    monthlyIncome: baseline.monthlyIncome,
    months,
    monthlyNeeded: Math.round(monthlyNeeded * 100) / 100,
    categories,
    reachable: saving >= monthlyNeeded - 0.005,
  };
}
