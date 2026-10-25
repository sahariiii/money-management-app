// Returns and refunds. Money back from a store is a refund, not income: it arrives as money in
// under the spending category it came back to, and the ledger links it to the purchase it returns
// (refundOf / refundedAmount, set by the backend's link_refunds in ledger.py; keep them in step).
// Spending counts only what was kept.

import { isIncomeCategory, type Transaction } from '@/types';

/** A refund returns a purchase from the same merchant made at most this many days before it (RETURN_DAYS in ledger.py). */
export const RETURN_DAYS = 120;

/** Money back for a purchase (a return, a rebate, a reversed charge): money in under a spending category. */
export const isRefund = (t: Transaction) => t.isIncome && !isIncomeCategory(t.category);

/** Money earned or received: money in under an income category. */
export const isEarned = (t: Transaction) => t.isIncome && isIncomeCategory(t.category);

/**
 * What a transaction adds to spending: a purchase less what came back for it. A refund the ledger
 * couldn't link to its purchase comes off spending on its own date; linked refunds and income add nothing.
 */
export function netSpending(t: Transaction): number {
  if (!t.isIncome) return t.amount - (t.refundedAmount ?? 0);
  return isRefund(t) && !t.refundOf ? -t.amount : 0;
}

/** 'returned': all of a purchase came back; 'partly-returned': some of it did. */
export function returnStatus(t: Transaction): 'returned' | 'partly-returned' | null {
  if (t.isIncome || !t.refundedAmount) return null;
  return t.refundedAmount >= t.amount - 0.005 ? 'returned' : 'partly-returned';
}
