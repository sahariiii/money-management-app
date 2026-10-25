// The only data access layer for screens.
//
// With EXPO_PUBLIC_API_URL set (in the root .env), transactions, cards,
// statements, budgets and the savings goal come from the FastAPI backend in
// backend/, and each request carries the signed-in user's Clerk session token.
// What the backend doesn't store yet (bills, alerts) starts empty, and anything
// the user adds to it lasts until the app reloads.
// The assistant is Claude on the backend, with the conversation saved there.
// Without EXPO_PUBLIC_API_URL everything is mock data from an in-memory copy.
// Summaries, budget and goal progress and the optimizer are computed here from
// the transactions either way.

import { getClerkInstance } from '@clerk/expo';
import Constants from 'expo-constants';
import { File as DeviceFile } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  DEMO_TODAY,
  alerts as seedAlerts,
  budgets as seedBudgets,
  cards as seedCards,
  chats as seedChats,
  recurringBills as seedBills,
  rewardRules as seedRules,
  transactions as seedTransactions,
} from '@/data/mock';
import { addDays, daysFrom, formatMonth, lastDayOf, shiftMonth, weekStart } from '@/lib/dates';
import { INCOME_CATEGORIES, isIncomeCategory } from '@/types';
import { formatMoney } from '@/lib/format';
import { isEarned, isRefund, netSpending } from '@/lib/refunds';
import { monthsBetween } from '@/lib/savings-plan';
import type {
  Alert,
  Budget,
  BudgetStatus,
  Card,
  CardOptimizer,
  Category,
  CategorySpend,
  CategoryUpdate,
  ChatMessage,
  ChatReply,
  ChatThread,
  ChatThreadDetail,
  DateRange,
  FeeCheck,
  ISODate,
  MerchantSpend,
  MonthTotals,
  NewCardInput,
  NewExpenseInput,
  OptimizerCategory,
  PickedFile,
  RangePreset,
  Receipt,
  ReceiptScan,
  RecurringBill,
  RecurringBillStatus,
  RewardRule,
  SavingsGoal,
  SavingsGoalStatus,
  SpendingBaseline,
  SpendSummary,
  Statement,
  StatementRewards,
  StatementUpload,
  Transaction,
  TransactionFilters,
  WeekTotals,
  YearMonth,
} from '@/types';

// ---------------------------------------------------------------------------
// Real backend (FastAPI in backend/)

/** The backend's base URL, or null to serve mock data. */
function apiUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
  if (!url) return null;
  // On a phone, localhost is the phone itself: use the computer serving the app instead.
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (Platform.OS === 'web' || !devHost) return url;
  return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/, `$1${devHost}`);
}

const API_URL = apiUrl();

/** Mock data when no backend is configured (EXPO_PUBLIC_API_URL unset). */
export const USE_MOCK = API_URL === null;

/** A failed backend request. `code` is set when a screen can act on it, e.g. 'password_required'. */
export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The signed-in user's Clerk session token (a short-lived JWT), or null when signed out. */
export async function getAuthToken(): Promise<string | null> {
  // Called outside React, so read the instance ClerkProvider created instead of useAuth().
  const clerk = getClerkInstance();
  return (await clerk?.session?.getToken()) ?? null;
}

/**
 * fetch() against the backend with `Authorization: Bearer <session token>`.
 * Never send a user ID: the backend verifies the token and takes the user from it.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new ApiError(401, 'Not signed in');
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch (e) {
    // Screens mostly show a spinner, so say where to look.
    console.warn(`Can't reach the backend at ${API_URL}. Is it running? (${e})`);
    throw e;
  }
  if (!res.ok) {
    // FastAPI errors are {"detail": "..."} or {"detail": {"code": ..., "message": ...}}.
    const detail = (await res.json().catch(() => null))?.detail;
    const message = typeof detail === 'string' ? detail : (detail?.message ?? `${init.method ?? 'GET'} ${path} failed with ${res.status}`);
    throw new ApiError(res.status, message, detail?.code);
  }
  // 204 No Content (e.g. a delete) has no body to parse.
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Like apiFetch, but null when the backend says 404. */
async function apiFetchOrNull<T>(path: string): Promise<T | null> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

function query(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// ---------------------------------------------------------------------------
// In-memory "database". With mock data, edits (recategorize, dismiss, add card,
// budgets, the savings goal, chat) persist for the session. With the backend it only
// holds what the backend doesn't store yet: it starts empty and lasts until the app reloads.

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** A conversation as the mock keeps it; mockThread lists it. */
type MockChat = { id: string; title: string; messages: ChatMessage[] };

const db: {
  transactions: Transaction[];
  alerts: Alert[];
  cards: Card[];
  rewardRules: RewardRule[];
  budgets: Budget[];
  goal: SavingsGoal | null;
  recurringBills: RecurringBill[];
  chats: MockChat[];
  /** merchant -> category, applied when the user picks "always for this merchant". */
  merchantRules: Record<string, Category>;
} = USE_MOCK
  ? {
      transactions: clone(seedTransactions),
      alerts: clone(seedAlerts),
      cards: clone(seedCards),
      rewardRules: clone(seedRules),
      budgets: clone(seedBudgets),
      goal: null,
      recurringBills: clone(seedBills),
      chats: clone(seedChats),
      merchantRules: {},
    }
  : { transactions: [], alerts: [], cards: [], rewardRules: [], budgets: [], goal: null, recurringBills: [], chats: [], merchantRules: {} };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Fake network latency for mock data. */
const delay = (ms = 300) => (USE_MOCK ? wait(ms) : Promise.resolve());
const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

let allInFlight: Promise<Transaction[]> | null = null;

/** Every transaction, for the summaries computed below. */
async function allTransactions(): Promise<Transaction[]> {
  if (!USE_MOCK) {
    // Screens load several summaries at once; they share one request.
    allInFlight ??= apiFetch<Transaction[]>('/api/transactions').finally(() => (allInFlight = null));
    return allInFlight;
  }
  await delay();
  return db.transactions;
}

// ---------------------------------------------------------------------------
// Dates

/** The demo date with mock data, the real date with the backend. */
export function today(): ISODate {
  if (USE_MOCK) return DEMO_TODAY;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentMonth(): YearMonth {
  return today().slice(0, 7);
}

export function resolveRange(range: RangePreset | DateRange): DateRange {
  if (typeof range !== 'string') return range;
  const month = currentMonth();
  switch (range) {
    case 'this-month':
      return { from: `${month}-01`, to: today() };
    case 'last-month': {
      const prev = shiftMonth(month, -1);
      return { from: `${prev}-01`, to: lastDayOf(prev) };
    }
    case 'last-3-months':
      return { from: `${shiftMonth(month, -2)}-01`, to: today() };
    case 'last-6-months':
      return { from: `${shiftMonth(month, -5)}-01`, to: today() };
    case 'year-to-date':
      return { from: `${today().slice(0, 4)}-01-01`, to: today() };
  }
}

const inRange = (t: Transaction, { from, to }: DateRange) => t.date >= from && t.date <= to;

/** Days in a range, counting both ends. */
const daysIn = ({ from, to }: DateRange) => daysFrom(from, to) + 1;

// ---------------------------------------------------------------------------
// Cards & transactions

/** The user's cards. The backend lists a placeholder card until one is added. */
export async function getCards(): Promise<Card[]> {
  if (!USE_MOCK) return apiFetch<Card[]>('/api/cards');
  await delay();
  return clone(db.cards);
}

export async function getCard(id: string): Promise<Card | null> {
  return (await getCards()).find((c) => c.id === id) ?? null;
}

export async function getRewardRules(cardId?: string): Promise<RewardRule[]> {
  let rules: RewardRule[];
  if (USE_MOCK) {
    await delay(150);
    rules = clone(db.rewardRules);
  } else {
    rules = await apiFetch<RewardRule[]>('/api/reward-rules');
  }
  return cardId ? rules.filter((r) => r.cardId === cardId) : rules;
}

/** Only ever keep the last 4 digits of card and account numbers, whatever the caller passes. */
function cleanCardInput(input: NewCardInput): NewCardInput {
  const last4 = (digits: string) => digits.replace(/\D/g, '').slice(-4);
  return { ...input, last4: last4(input.last4), accountLast4: last4(input.accountLast4 ?? '') || undefined };
}

/** Saves a card and its reward rules in the mock db under `id`, replacing what it had. */
function storeMockCard(id: string, input: NewCardInput): Card {
  const { rules, ...fields } = input;
  const card: Card = { ...fields, id };
  const i = db.cards.findIndex((c) => c.id === id);
  if (i >= 0) db.cards[i] = card;
  else db.cards.push(card);
  db.rewardRules = [...db.rewardRules.filter((r) => r.cardId !== id), ...rules.map((r) => ({ ...r, cardId: id }))];
  return clone(card);
}

export async function addCard(input: NewCardInput): Promise<Card> {
  const clean = cleanCardInput(input);
  if (!USE_MOCK) return apiFetch<Card>('/api/cards', { method: 'POST', body: JSON.stringify(clean) });
  await delay(500);
  return storeMockCard(`card_${Date.now()}`, clean);
}

/** Replaces a card's details and all of its reward rules. */
export async function updateCard(id: string, input: NewCardInput): Promise<Card> {
  const clean = cleanCardInput(input);
  if (!USE_MOCK) {
    return apiFetch<Card>(`/api/cards/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(clean) });
  }
  await delay(500);
  if (!db.cards.some((c) => c.id === id)) throw new ApiError(404, 'Card not found.');
  return storeMockCard(id, clean);
}

/** Deletes a card and its reward rules. Its past transactions stay, without a card. */
export async function deleteCard(id: string): Promise<void> {
  if (!USE_MOCK) return apiFetch<void>(`/api/cards/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await delay(400);
  db.cards = db.cards.filter((c) => c.id !== id);
  db.rewardRules = db.rewardRules.filter((r) => r.cardId !== id);
}

export async function getTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
  if (!USE_MOCK) return apiFetch<Transaction[]>(`/api/transactions${query(filters)}`);
  await delay();
  const search = filters.search?.trim().toLowerCase();
  const result = db.transactions
    .filter((t) => {
      if (filters.from && t.date < filters.from) return false;
      if (filters.to && t.date > filters.to) return false;
      if (filters.category && t.category !== filters.category) return false;
      if (filters.cardId && t.cardId !== filters.cardId) return false;
      if (filters.kind === 'income' && !t.isIncome) return false;
      if (filters.kind === 'expense' && t.isIncome) return false;
      if (search) {
        const haystack = `${t.merchant} ${t.rawDescription} ${t.category}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return clone(filters.limit ? result.slice(0, filters.limit) : result);
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  if (!USE_MOCK) return apiFetchOrNull<Transaction>(`/api/transactions/${encodeURIComponent(id)}`);
  await delay(150);
  const tx = db.transactions.find((t) => t.id === id);
  return tx ? clone(tx) : null;
}

export async function updateCategory(
  id: string,
  category: Category,
  alwaysForMerchant = false,
): Promise<CategoryUpdate> {
  if (!USE_MOCK) {
    return apiFetch<CategoryUpdate>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ category, alwaysForMerchant }),
    });
  }
  await delay();
  const tx = db.transactions.find((t) => t.id === id);
  if (!tx) throw new Error(`Transaction ${id} not found`);

  let affectedCount = 1;
  if (alwaysForMerchant) {
    db.merchantRules[tx.merchant] = category;
    const sameMerchant = db.transactions.filter((t) => t.merchant === tx.merchant);
    sameMerchant.forEach((t) => (t.category = category));
    affectedCount = sameMerchant.length;
  } else {
    tx.category = category;
  }
  return { transaction: clone(tx), affectedCount };
}

// ---------------------------------------------------------------------------
// Summaries

/**
 * Spending nets returns out (netSpending): a returned purchase adds nothing. Income is money in
 * under income categories only; refunds aren't income.
 */
function summarize(all: Transaction[], range: DateRange): SpendSummary {
  const txs = all.filter((t) => inRange(t, range));
  const spending = txs.map((t) => [t, netSpending(t)] as const).filter(([, amount]) => amount !== 0);
  const earned = txs.filter(isEarned);
  const totalSpent = sum(spending.map(([, amount]) => amount));
  const totalIncome = sum(earned.map((t) => t.amount));

  const byCat = new Map<Category, { amount: number; count: number }>();
  const byMerchant = new Map<string, { amount: number; count: number }>();
  for (const [t, amount] of spending) {
    const c = byCat.get(t.category) ?? { amount: 0, count: 0 };
    byCat.set(t.category, { amount: c.amount + amount, count: c.count + 1 });
    const m = byMerchant.get(t.merchant) ?? { amount: 0, count: 0 };
    byMerchant.set(t.merchant, { amount: m.amount + amount, count: m.count + 1 });
  }
  const incomeByCat = new Map<Category, { amount: number; count: number }>();
  for (const t of earned) {
    const c = incomeByCat.get(t.category) ?? { amount: 0, count: 0 };
    incomeByCat.set(t.category, { amount: c.amount + t.amount, count: c.count + 1 });
  }

  const byMonthMap = new Map<YearMonth, MonthTotals>();
  const monthOf = (t: Transaction) => {
    const month = t.date.slice(0, 7);
    const row = byMonthMap.get(month) ?? { month, spent: 0, income: 0 };
    byMonthMap.set(month, row);
    return row;
  };
  for (const [t, amount] of spending) monthOf(t).spent += amount;
  for (const t of earned) monthOf(t).income += t.amount;

  // A category or merchant can come out at 0 or below when only a refund for it falls in the range.
  const byCategory: CategorySpend[] = [...byCat]
    .filter(([, v]) => v.amount > 0.005)
    .map(([category, v]) => ({
      category,
      amount: round2(v.amount),
      count: v.count,
      share: totalSpent ? round2(v.amount / totalSpent) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const incomeByCategory: CategorySpend[] = [...incomeByCat]
    .map(([category, v]) => ({
      category,
      amount: round2(v.amount),
      count: v.count,
      share: totalIncome ? round2(v.amount / totalIncome) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const topMerchants: MerchantSpend[] = [...byMerchant]
    .filter(([, v]) => v.amount > 0.005)
    .map(([merchant, v]) => ({ merchant, amount: round2(v.amount), count: v.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const byMonth = [...byMonthMap.values()]
    .map((r) => ({ ...r, spent: round2(r.spent), income: round2(r.income) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    range,
    totalSpent: round2(totalSpent),
    totalIncome: round2(totalIncome),
    net: round2(totalIncome - totalSpent),
    transactionCount: txs.length,
    byCategory,
    incomeByCategory,
    byMonth,
    topMerchants,
  };
}

export async function getSpendSummary(range: RangePreset | DateRange = 'this-month'): Promise<SpendSummary> {
  return summarize(await allTransactions(), resolveRange(range));
}

/** Every month from the first one with transactions through the current month, oldest first. */
export async function getMonths(): Promise<YearMonth[]> {
  const txs = await allTransactions();
  const first = txs.reduce((min, t) => (t.date < min ? t.date : min), today()).slice(0, 7);
  const months: YearMonth[] = [];
  for (let m = first; m <= currentMonth(); m = shiftMonth(m, 1)) months.push(m);
  return months;
}

/**
 * Spending per week (weeks start Monday). Rent is excluded by default so the
 * trend shows day-to-day spending instead of a spike every 1st of the month.
 */
export async function getWeeklySpend(
  range: RangePreset | DateRange = 'last-3-months',
  excludeCategories: Category[] = ['Housing'],
): Promise<WeekTotals[]> {
  const txs = await allTransactions();
  const resolved = resolveRange(range);
  // Start at the first full week so a partial first week doesn't read as a dip.
  const firstMonday = weekStart(resolved.from) === resolved.from ? resolved.from : addDays(weekStart(resolved.from), 7);
  const r = { ...resolved, from: firstMonday };
  const weeks = new Map<ISODate, number>();
  // Seed every week in range so quiet weeks show as 0 instead of disappearing.
  for (let w = r.from; w <= r.to; w = addDays(w, 7)) weeks.set(w, 0);
  for (const t of txs.filter((t) => inRange(t, r))) {
    if (excludeCategories.includes(t.category)) continue;
    const w = weekStart(t.date);
    weeks.set(w, (weeks.get(w) ?? 0) + netSpending(t));
  }
  return [...weeks]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([start, spent]) => ({ weekStart: start, spent: round2(Math.max(0, spent)) }));
}

// ---------------------------------------------------------------------------
// Budgets and the savings goal

/** Spent against a budget is purchases less what was returned (netSpending). */
function budgetStatus(all: Transaction[], budgets: Budget[], month: YearMonth): BudgetStatus[] {
  const range = { from: `${month}-01`, to: lastDayOf(month) };
  const txs = all.filter((t) => inRange(t, range));
  return budgets.map((b) => {
    const total = Math.max(0, sum(txs.filter((t) => t.category === b.category).map(netSpending)));
    return {
      ...b,
      month,
      spent: round2(total),
      remaining: round2(b.monthlyLimit - total),
      ratio: round2(total / b.monthlyLimit),
    };
  });
}

async function savedBudgets(): Promise<Budget[]> {
  if (!USE_MOCK) return apiFetch<Budget[]>('/api/budgets');
  return clone(db.budgets);
}

export async function getBudgets(month: YearMonth = currentMonth()): Promise<BudgetStatus[]> {
  const [all, budgets] = await Promise.all([allTransactions(), savedBudgets()]);
  return budgetStatus(all, budgets, month);
}

/** Creates or updates the monthly limit for a category. */
export async function setBudget(category: Category, monthlyLimit: number): Promise<Budget> {
  if (!(monthlyLimit > 0)) throw new Error('Budget limit must be above 0');
  const limit = round2(monthlyLimit);
  if (!USE_MOCK) {
    return apiFetch<Budget>(`/api/budgets/${encodeURIComponent(category)}`, {
      method: 'PUT',
      body: JSON.stringify({ monthlyLimit: limit }),
    });
  }
  await delay(250);
  const existing = db.budgets.find((b) => b.category === category);
  if (existing) existing.monthlyLimit = limit;
  else db.budgets.push({ category, monthlyLimit: limit });
  return { category, monthlyLimit: limit };
}

/** Complete months a savings plan averages over. */
const BASELINE_MONTHS = 3;
/** A month counts as complete when the ledger covers it to within this many days of either end. */
const MONTH_EDGE_DAYS = 7;

/**
 * Average monthly income and spending per category over the latest complete months (up to 3),
 * for planning savings. A month the ledger only partly covers is left out: usually the current
 * one, or the first and last months of a statement that runs mid-month to mid-month.
 */
export async function getSpendingBaseline(): Promise<SpendingBaseline> {
  const all = await allTransactions();
  const dates = all.map((t) => t.date).sort();
  const months: YearMonth[] = [];
  if (dates.length) {
    const first = dates[0];
    const last = dates[dates.length - 1];
    const firstMonth = Number(first.slice(8)) <= MONTH_EDGE_DAYS ? first.slice(0, 7) : shiftMonth(first.slice(0, 7), 1);
    const lastMonth =
      last.slice(0, 7) < currentMonth() && last >= addDays(lastDayOf(last.slice(0, 7)), -MONTH_EDGE_DAYS)
        ? last.slice(0, 7)
        : shiftMonth(last.slice(0, 7), -1);
    for (let m = lastMonth; m >= firstMonth && months.length < BASELINE_MONTHS; m = shiftMonth(m, -1)) months.unshift(m);
  }
  if (!months.length) return { months, monthlyIncome: 0, categories: [] };

  const txs = all.filter((t) => inRange(t, { from: `${months[0]}-01`, to: lastDayOf(months[months.length - 1]) }));
  const income = sum(txs.filter(isEarned).map((t) => t.amount));
  // Returns come off the spending they came back to.
  const byCategory = new Map<Category, number>();
  for (const t of txs) {
    if (isIncomeCategory(t.category)) continue;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + netSpending(t));
  }
  return {
    months,
    monthlyIncome: round2(income / months.length),
    categories: [...byCategory]
      .map(([category, total]) => ({ category, average: round2(total / months.length) }))
      .filter((c) => c.average > 0)
      .sort((a, b) => b.average - a.average),
  };
}

function goalStatus(goal: SavingsGoal, all: Transaction[]): SavingsGoalStatus {
  const end = today() < goal.targetDate ? today() : goal.targetDate;
  const txs = all.filter((t) => t.date >= goal.startDate && t.date <= end);
  const asOf = txs.reduce((latest, t) => (t.date > latest ? t.date : latest), goal.startDate);
  const saved = sum(txs.map((t) => (t.isIncome ? t.amount : -t.amount)));
  const pace = Math.min(1, Math.max(0, daysFrom(goal.startDate, asOf) / daysFrom(goal.startDate, goal.targetDate)));
  const expected = goal.targetAmount * pace;
  const left = Math.max(0, goal.targetAmount - saved);
  const monthsLeft = monthsBetween(asOf, goal.targetDate);
  return {
    ...goal,
    saved: round2(saved),
    asOf,
    transactionCount: txs.length,
    expected: round2(expected),
    ratio: round2(saved / goal.targetAmount),
    onTrack: saved >= expected - 0.005,
    monthlyNeeded: round2(monthsLeft > 0 ? left / monthsLeft : left),
    daysLeft: daysFrom(today(), goal.targetDate),
  };
}

/** The savings goal with its progress so far, or null when none is set. */
export async function getSavingsGoal(): Promise<SavingsGoalStatus | null> {
  const [goal, all] = await Promise.all([
    USE_MOCK ? delay(150).then(() => clone(db.goal)) : apiFetch<SavingsGoal | null>('/api/goal'),
    allTransactions(),
  ]);
  return goal ? goalStatus(goal, all) : null;
}

/** Saves the goal and replaces every budget with `budgets`, the ones that reach it. */
export async function saveSavingsGoal(goal: SavingsGoal, budgets: Budget[]): Promise<SavingsGoal> {
  const clean = budgets.filter((b) => b.monthlyLimit > 0).map((b) => ({ ...b, monthlyLimit: round2(b.monthlyLimit) }));
  if (!USE_MOCK) return apiFetch<SavingsGoal>('/api/goal', { method: 'PUT', body: JSON.stringify({ goal, budgets: clean }) });
  await delay(400);
  db.goal = clone(goal);
  db.budgets = clean;
  return clone(goal);
}

/** Removes the goal; the budgets stay. */
export async function deleteSavingsGoal(): Promise<void> {
  if (!USE_MOCK) return apiFetch<void>('/api/goal', { method: 'DELETE' });
  await delay(250);
  db.goal = null;
}

// ---------------------------------------------------------------------------
// Bills & alerts

/** A bill counts as unusual when the last charge is 25%+ above the usual amount. */
const UNUSUAL_BILL_CHANGE = 0.25;

export async function getRecurringBills(): Promise<RecurringBillStatus[]> {
  await delay();
  return db.recurringBills
    .map((b) => {
      const changeFromUsual = round2((b.lastAmount - b.expectedAmount) / b.expectedAmount);
      const lastCharge = db.transactions.filter((t) => t.merchant === b.merchant).at(-1);
      return {
        ...clone(b),
        category: lastCharge?.category ?? 'Other',
        changeFromUsual,
        unusual: changeFromUsual >= UNUSUAL_BILL_CHANGE,
        daysUntilDue: daysFrom(today(), b.nextDue),
      };
    })
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

export async function getAlerts(status?: Alert['status']): Promise<Alert[]> {
  await delay();
  const list = status ? db.alerts.filter((a) => a.status === status) : db.alerts;
  // Open alerts first.
  return clone(list).sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1));
}

export async function dismissAlert(id: string): Promise<Alert | null> {
  await delay(150);
  const alert = db.alerts.find((a) => a.id === id);
  if (!alert) return null;
  alert.status = 'dismissed';
  return clone(alert);
}

// ---------------------------------------------------------------------------
// Card rewards optimizer

/**
 * Categories that earn no rewards and can't move to another card: rent can't realistically go on
 * a credit card, and fees and interest are charged by the card itself.
 */
const NOT_CARD_PAYABLE: Category[] = ['Housing', 'Fees & interest', ...INCOME_CATEGORIES];

/** Purchases and refunds that earn (or take back) rewards, oldest first. */
const rewardable = (txs: Transaction[]) =>
  txs
    .filter((t) => (!t.isIncome || isRefund(t)) && !NOT_CARD_PAYABLE.includes(t.category))
    .sort((a, b) => a.date.localeCompare(b.date));

/** +1 for a purchase, -1 for a refund. */
const sign = (t: Transaction) => (isRefund(t) ? -1 : 1);

function ruleFor(rules: RewardRule[], cardId: string, category: Category) {
  const own = rules.filter((r) => r.cardId === cardId);
  return own.find((r) => r.category === category) ?? own.find((r) => r.category === '*');
}

/**
 * Cashback for putting `amount` on a card. Caps are monthly spend limits per rule;
 * spend past the cap earns the card's '*' rate. `usage` tracks spend per rule/month
 * and is only updated when `commit` is true. A refund takes back cashback at the
 * rule's rate (negative), as card issuers do.
 */
function rewardFor(
  rules: RewardRule[],
  cardId: string,
  t: Transaction,
  usage: Map<string, number>,
  commit: boolean,
): number {
  const rule = ruleFor(rules, cardId, t.category);
  if (!rule) return 0;
  if (isRefund(t)) return (-t.amount * rule.ratePercent) / 100;
  let eligible = t.amount;
  if (rule.cap !== null) {
    const key = `${cardId}|${rule.category}|${t.date.slice(0, 7)}`;
    const used = usage.get(key) ?? 0;
    eligible = Math.max(0, Math.min(t.amount, rule.cap - used));
    if (commit) usage.set(key, used + t.amount);
  }
  const base = rules.find((r) => r.cardId === cardId && r.category === '*');
  const fallbackRate = base && base !== rule ? base.ratePercent : 0;
  return (eligible * rule.ratePercent + (t.amount - eligible) * fallbackRate) / 100;
}

function optimize(all: Transaction[], cards: Card[], rules: RewardRule[], range: DateRange): CardOptimizer {
  const txs = rewardable(all.filter((t) => inRange(t, range)));

  const actualUsage = new Map<string, number>();
  const bestUsage = new Map<string, number>();

  type Acc = { spent: number; earned: number; potential: number; byCard: Map<string, number>; bestByCard: Map<string, number> };
  const cats = new Map<Category, Acc>();
  const perCard = new Map<string, { spent: number; earned: number }>();
  const potentialByCard = new Map<string, number>();

  for (const t of txs) {
    const earned = rewardFor(rules, t.cardId, t, actualUsage, true);
    const amount = sign(t) * t.amount;

    // Best case: the card that would have paid the most for this purchase. For a refund,
    // the card that would have taken the most back, since that is where the purchase went.
    let bestCard = t.cardId;
    let bestReward = 0;
    let bestScore = -Infinity;
    for (const card of cards) {
      const r = rewardFor(rules, card.id, t, bestUsage, false);
      if (sign(t) * r > bestScore) {
        bestScore = sign(t) * r;
        bestReward = r;
        bestCard = card.id;
      }
    }
    rewardFor(rules, bestCard, t, bestUsage, true);
    potentialByCard.set(bestCard, (potentialByCard.get(bestCard) ?? 0) + bestReward);

    const acc = cats.get(t.category) ?? { spent: 0, earned: 0, potential: 0, byCard: new Map(), bestByCard: new Map() };
    acc.spent += amount;
    acc.earned += earned;
    acc.potential += bestReward;
    acc.byCard.set(t.cardId, (acc.byCard.get(t.cardId) ?? 0) + amount);
    acc.bestByCard.set(bestCard, (acc.bestByCard.get(bestCard) ?? 0) + amount);
    cats.set(t.category, acc);

    const c = perCard.get(t.cardId) ?? { spent: 0, earned: 0 };
    perCard.set(t.cardId, { spent: c.spent + amount, earned: c.earned + earned });
  }

  const byCategory: OptimizerCategory[] = [...cats]
    .map(([category, a]) => ({
      category,
      spent: round2(a.spent),
      earned: round2(a.earned),
      potential: round2(a.potential),
      missed: round2(a.potential - a.earned),
      bestCardId: [...a.bestByCard].sort((x, y) => y[1] - x[1])[0][0],
      spendByCard: [...a.byCard].map(([cardId, amount]) => ({ cardId, amount: round2(amount) })),
    }))
    .sort((a, b) => b.missed - a.missed);

  const earned = sum(byCategory.map((c) => c.earned));
  const potential = sum(byCategory.map((c) => c.potential));
  const missed = potential - earned;
  const yearFactor = 365 / daysIn(range);

  const cardName = (id: string) => {
    const card = cards.find((c) => c.id === id);
    return card ? `${card.nickname} (•••• ${card.last4})` : id;
  };

  const tips = byCategory
    .filter((c) => c.missed >= 1)
    .slice(0, 3)
    .map((c) => `Use ${cardName(c.bestCardId)} for ${c.category}: you'd have earned ${formatMoney(c.missed)} more in this period.`);

  const feeChecks: FeeCheck[] = cards
    .filter((c) => c.annualFee > 0)
    .map((c) => {
      const earnedPerYear = round2((perCard.get(c.id)?.earned ?? 0) * yearFactor);
      return {
        cardId: c.id,
        annualFee: c.annualFee,
        earnedPerYear,
        potentialPerYear: round2((potentialByCard.get(c.id) ?? 0) * yearFactor),
        covered: earnedPerYear >= c.annualFee,
      };
    });

  return {
    range,
    earned: round2(earned),
    potential: round2(potential),
    missed: round2(missed),
    missedPerYear: round2(missed * yearFactor),
    byCategory,
    byCard: cards.map((c) => {
      const v = perCard.get(c.id) ?? { spent: 0, earned: 0 };
      return { cardId: c.id, spent: round2(v.spent), earned: round2(v.earned) };
    }),
    feeChecks,
    tips,
  };
}

export async function getCardOptimizer(period: RangePreset | DateRange = 'last-3-months'): Promise<CardOptimizer> {
  const [txs, cards, rules] = await Promise.all([allTransactions(), getCards(), getRewardRules()]);
  return optimize(txs, cards, rules, resolveRange(period));
}

/**
 * Each card's rewards on its latest statement: the statement's printed summary (`reported`, the
 * amount to show) next to the app's own estimate by rate. The estimate counts the statement's own
 * transactions, whatever their dates (purchases from just before the period can post into it).
 * Backend only: mock transactions have no statements.
 */
export async function getStatementRewards(): Promise<StatementRewards[]> {
  if (USE_MOCK) return [];
  const [txs, rules, statements] = await Promise.all([allTransactions(), getRewardRules(), getStatements()]);
  const byStatement = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.statementId) byStatement.set(t.statementId, [...(byStatement.get(t.statementId) ?? []), t]);
  }

  const latest = new Map<string, StatementRewards>();
  for (const s of statements) {
    const rows = byStatement.get(s.id) ?? [];
    if (!s.cardId || rows.length === 0 || !rules.some((r) => r.cardId === s.cardId)) continue;
    const dates = rows.map((t) => t.date).sort();
    const range = { from: s.periodStart ?? dates[0], to: s.periodEnd ?? dates[dates.length - 1] };
    const prev = latest.get(s.cardId);
    if (prev && prev.range.to >= range.to) continue;

    const rates = new Map<number, { spent: number; earned: number }>();
    const usage = new Map<string, number>();
    for (const t of rewardable(rows)) {
      const rate = ruleFor(rules, s.cardId, t.category)?.ratePercent ?? 0;
      const acc = rates.get(rate) ?? { spent: 0, earned: 0 };
      acc.spent += sign(t) * t.amount;
      acc.earned += rewardFor(rules, s.cardId, t, usage, true);
      rates.set(rate, acc);
    }
    const byRate = [...rates]
      .filter(([rate]) => rate > 0)
      .map(([ratePercent, a]) => ({ ratePercent, spent: round2(a.spent), earned: round2(a.earned) }))
      .sort((a, b) => b.ratePercent - a.ratePercent);
    latest.set(s.cardId, {
      cardId: s.cardId,
      statementId: s.id,
      statementName: s.name.replace(/\.pdf$/i, ''),
      range,
      spent: round2(sum(byRate.map((r) => r.spent))),
      earned: round2(sum(byRate.map((r) => r.earned))),
      byRate,
      reported: s.rewards,
    });
  }
  return [...latest.values()];
}

// ---------------------------------------------------------------------------
// Assistant. With the backend it is Claude with tools over the ledger
// (backend/personal_banker/assistant.py), and the conversation is saved there.
// Mock mode gives canned answers computed from the mock data.

type Answer = Pick<ChatMessage, 'text' | 'summary'>;

let messageSeq = 0;
const message = (role: ChatMessage['role'], answer: Answer): ChatMessage => ({
  id: `msg_${Date.now()}_${messageSeq++}`,
  role,
  createdAt: new Date().toISOString(),
  ...answer,
});

function onTrackAnswer(all: Transaction[]): Answer {
  const month = currentMonth();
  const dayOfMonth = Number(today().slice(8));
  const daysLeft = Number(lastDayOf(month).slice(8)) - dayOfMonth;
  const prev = shiftMonth(month, -1);

  const thisMonth = summarize(all, { from: `${month}-01`, to: today() }).totalSpent;
  const lastMonthToDate = summarize(all, { from: `${prev}-01`, to: `${prev}-${today().slice(8)}` }).totalSpent;
  const diff = thisMonth - lastMonthToDate;

  const statuses = budgetStatus(all, db.budgets, month);
  const hot = statuses.filter((b) => b.ratio >= 0.8).sort((a, b) => b.ratio - a.ratio);

  const lines = [
    `You've spent ${formatMoney(thisMonth)} so far this month, ${formatMoney(Math.abs(diff))} ${diff >= 0 ? 'more' : 'less'} than at this point last month.`,
  ];
  if (hot.length === 0) {
    lines.unshift('Yes, you are on track.');
    lines.push('Every budget is under 80%.');
    return { text: lines.join(' '), summary: { value: formatMoney(thisMonth), label: 'Spent this month', tone: 'primary' } };
  }

  lines.unshift(hot.some((b) => b.ratio >= 1) ? 'Not quite.' : 'Mostly, with one thing to watch.');
  for (const b of hot) {
    lines.push(
      `${b.category}: ${formatMoney(b.spent)} of ${formatMoney(b.monthlyLimit)} (${Math.round(b.ratio * 100)}%) with ${daysLeft} days left.`,
    );
  }
  const others = statuses.length - hot.length;
  if (others > 0) lines.push(`Your other ${others} budgets are under 80%.`);
  const top = hot[0];
  return {
    text: lines.join(' '),
    summary: {
      value: `${Math.round(top.ratio * 100)}%`,
      label: `${top.category} budget used`,
      tone: top.ratio >= 1 ? 'expense' : 'warning',
    },
  };
}

function restaurantsAnswer(all: Transaction[]): Answer {
  const range = { from: '2026-07-01', to: today() };
  const food = all.filter((t) => t.category === 'Food' && !t.isIncome && inRange(t, range));
  const total = sum(food.map((t) => t.amount));

  const months = new Map<YearMonth, number>();
  const merchants = new Map<string, number>();
  for (const t of food) {
    months.set(t.date.slice(0, 7), (months.get(t.date.slice(0, 7)) ?? 0) + t.amount);
    merchants.set(t.merchant, (merchants.get(t.merchant) ?? 0) + t.amount);
  }
  const breakdown = [...months]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, amt]) => `${formatMonth(ym, 'name')} ${formatMoney(amt)}`)
    .join(', ');
  const [topMerchant, topAmount] = [...merchants].sort((a, b) => b[1] - a[1])[0] ?? ['none', 0];

  return {
    text:
      `Since July you've spent ${formatMoney(total)} on restaurants, cafés and takeout across ${food.length} purchases ` +
      `(${breakdown}; my records start in August). Your top spot is ${topMerchant} at ${formatMoney(topAmount)}.`,
    summary: { value: formatMoney(total), label: 'Restaurants & takeout since July', tone: 'expense' },
  };
}

function cardAnswer(question: string, all: Transaction[], cards: Card[]): Answer {
  const opt = optimize(all, cards, db.rewardRules, resolveRange('this-month'));
  const asked = opt.byCategory.find((c) => question.includes(c.category.toLowerCase()));
  const pick = asked ?? opt.byCategory[0];
  if (!pick) return { text: "You haven't spent anything on cards this month yet." };

  const best = cards.find((c) => c.id === pick.bestCardId);
  const rate = best ? ruleFor(db.rewardRules, best.id, pick.category)?.ratePercent ?? 0 : 0;
  const name = best ? `${best.nickname} (•••• ${best.last4})` : 'your best card';
  const category = pick.category.toLowerCase();

  if (pick.missed < 0.01) {
    return { text: `You're already using ${name} for ${category}, which is the best option at ${rate}% back.` };
  }
  return {
    text:
      `Use ${name} for ${category}: it pays ${rate}% back. This month you put ${formatMoney(pick.spent - (pick.spendByCard.find((c) => c.cardId === pick.bestCardId)?.amount ?? 0))} ` +
      `of ${category} on a card that earns less, which left ${formatMoney(pick.missed)} on the table.`,
    summary: { value: `+${formatMoney(pick.missed)}`, label: `More cashback on ${category} this month`, tone: 'income' },
  };
}

const FALLBACK: Answer = {
  text:
    "I'm still learning your habits. I can help with budgets, spending by category and which card to use. " +
    'Try "Am I on track this month?" or "How much on restaurants since July?"',
};

/** Starter questions for an empty chat; mock mode only answers its canned ones. */
export const CHAT_SUGGESTIONS = USE_MOCK
  ? ['Am I on track this month?', 'How much on restaurants since July?', 'Which card should I use for groceries?']
  : [
      'How does this month compare to last month?',
      'What did I spend on each card last month?',
      'Where could I cut back?',
    ];

// Conversations, like the chat history in Claude or ChatGPT. With the backend Claude names a
// conversation on its first question; the mock names it after the question.

/** The text on one line, cut at a word boundary with "…" when longer than `limit` (as _shorten in assistant.py). */
function shorten(text: string, limit: number) {
  const flat = text.split(/\s+/).filter(Boolean).join(' ');
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1);
  return `${(cut.slice(0, cut.lastIndexOf(' ')) || cut).replace(/[ ,.;:]+$/, '')}…`;
}

function mockThread(chat: MockChat): ChatThread {
  const { messages } = chat;
  const latest = [...messages].reverse().find((m) => m.role === 'assistant') ?? messages[messages.length - 1];
  return {
    id: chat.id,
    title: chat.title,
    createdAt: messages[0]?.createdAt ?? '',
    updatedAt: messages[messages.length - 1]?.createdAt ?? '',
    messageCount: messages.length,
    preview: latest ? shorten(latest.text, 120) : '',
  };
}

function mockChat(id: string): MockChat {
  const chat = db.chats.find((c) => c.id === id);
  if (!chat) throw new ApiError(404, 'Conversation not found.');
  return chat;
}

/** Every conversation, the latest active first. */
export async function getChatThreads(): Promise<ChatThread[]> {
  if (!USE_MOCK) return apiFetch<ChatThread[]>('/api/chats');
  await delay(150);
  return db.chats.map(mockThread).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** A conversation with its messages, oldest first; null when there's none with that id. */
export async function getChatThread(id: string): Promise<ChatThreadDetail | null> {
  if (!USE_MOCK) return apiFetchOrNull<ChatThreadDetail>(`/api/chats/${encodeURIComponent(id)}`);
  await delay(150);
  const chat = db.chats.find((c) => c.id === id);
  return chat ? clone({ ...mockThread(chat), messages: chat.messages }) : null;
}

/**
 * Asks the assistant in conversation `threadId`, or starts a new one when it is null, and returns
 * the reply with its conversation. With the backend this takes a few seconds to half a minute,
 * while Claude looks things up; when it fails, nothing is stored (a new conversation isn't
 * created) and the question can be sent again.
 */
export async function sendChatMessage(text: string, threadId: string | null): Promise<ChatReply> {
  if (!USE_MOCK) {
    const path = threadId ? `/api/chats/${encodeURIComponent(threadId)}/messages` : '/api/chats';
    try {
      return await apiFetch<ChatReply>(path, { method: 'POST', body: JSON.stringify({ text }) });
    } catch (e) {
      // A backend started before conversations existed doesn't have the routes.
      if (e instanceof ApiError && e.status === 405) {
        throw new ApiError(e.status, "The server doesn't have chat history yet. Restart the backend and try again.");
      }
      throw e;
    }
  }
  const chat = threadId ? mockChat(threadId) : { id: `chat_${Date.now().toString(16)}`, title: shorten(text, 60), messages: [] };
  await delay(1200);
  const q = text.toLowerCase();
  let answer = FALLBACK;
  if (q.includes('on track')) answer = onTrackAnswer(db.transactions);
  else if (/restaurant|eating out|dining|takeout|take-out/.test(q)) answer = restaurantsAnswer(db.transactions);
  else if (/\bcard\b|cashback|rewards?/.test(q)) answer = cardAnswer(q, db.transactions, db.cards);
  const reply = message('assistant', answer);
  chat.messages.push(message('user', { text }), reply);
  if (!threadId) db.chats.push(chat);
  return clone({ thread: mockThread(chat), message: reply });
}

export async function renameChatThread(id: string, title: string): Promise<ChatThread> {
  if (!USE_MOCK) {
    return apiFetch<ChatThread>(`/api/chats/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
  }
  await delay(150);
  const chat = mockChat(id);
  chat.title = shorten(title, 60);
  return mockThread(chat);
}

export async function deleteChatThread(id: string): Promise<void> {
  if (!USE_MOCK) return apiFetch<void>(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await delay(150);
  db.chats = db.chats.filter((c) => c.id !== id);
}

// ---------------------------------------------------------------------------
// Statements and receipts

const NEEDS_BACKEND = 'This needs the backend: set EXPO_PUBLIC_API_URL in .env.';
/** Adds a picked file to an upload. */
async function appendFile(form: FormData, field: string, file: PickedFile) {
  if (Platform.OS === 'web') {
    // On web the picker's uri is a blob: or data: URL for the chosen file.
    form.append(field, await (await fetch(file.uri)).blob(), file.name);
  } else {
    // Expo's fetch, which replaces React Native's, can't send React Native's { uri, name, type }
    // parts ("Unsupported FormDataPart implementation"); it sends an expo-file-system File.
    // That part is named after the file on the device, so callers send the real name separately.
    form.append(field, new DeviceFile(file.uri) as unknown as Blob);
  }
}

/** How long uploadStatement waits for the backend to read a statement, and how often it checks. */
const UPLOAD_TIMEOUT_MS = 20 * 60_000;
const POLL_MS = 2000;

/** Statements uploaded to the backend, newest first. */
export async function getStatements(): Promise<Statement[]> {
  return USE_MOCK ? [] : apiFetch<Statement[]>('/api/statements');
}

export async function getStatement(id: string): Promise<Statement | null> {
  return USE_MOCK ? null : apiFetchOrNull<Statement>(`/api/statements/${encodeURIComponent(id)}`);
}

/** Processes a statement again after it stopped short (status 'incomplete'). */
export async function processStatement(id: string): Promise<Statement> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return apiFetch<Statement>(`/api/statements/${encodeURIComponent(id)}/process`, { method: 'POST' });
}

/**
 * Uploads a PDF statement and resolves once the backend has read and
 * categorized it, which can take minutes. Throws an ApiError with code
 * 'password_required' when the PDF needs a password (or the one given was
 * wrong), and with code 'incomplete' when the backend couldn't finish.
 */
export async function uploadStatement(file: PickedFile, password?: string): Promise<StatementUpload> {
  if (USE_MOCK) return mockUploadStatement(file);

  const form = new FormData();
  await appendFile(form, 'file', file);
  form.append('filename', file.name);
  if (password) form.append('password', password);

  let statement = await apiFetch<Statement>('/api/statements', { method: 'POST', body: form });
  // A statement that is already in the library comes back done straight away.
  const alreadyThere = statement.status === 'done';
  const started = Date.now();
  while (statement.status === 'processing') {
    if (Date.now() - started > UPLOAD_TIMEOUT_MS) {
      throw new ApiError(504, 'The statement is still being read. Check back in a few minutes.', 'timeout');
    }
    await wait(POLL_MS);
    statement = await apiFetch<Statement>(`/api/statements/${encodeURIComponent(statement.id)}`);
  }
  if (statement.status === 'incomplete') {
    throw new ApiError(422, statement.message ?? "The statement couldn't be read.", 'incomplete');
  }

  // Transaction ids start with their statement's id.
  const rows = (await allTransactions()).filter((t) => t.id.startsWith(`${statement.id}-`));
  const dates = rows.map((t) => t.date).sort();
  return {
    fileName: file.name,
    transactionsFound: rows.length,
    range: { from: dates[0] ?? today(), to: dates.at(-1) ?? today() },
    totalSpent: round2(sum(rows.map(netSpending))),
    totalIncome: round2(sum(rows.filter(isEarned).map((t) => t.amount))),
    alreadyInLedger: alreadyThere ? rows.length : 0,
    newTransactions: alreadyThere ? 0 : rows.length,
    balanceCheck: 'not_checked',
  };
}

async function mockUploadStatement(file: PickedFile): Promise<StatementUpload> {
  await delay(2400);
  // Pretend the statement holds the 40 most recent ledger rows, so everything matches.
  const rows = [...db.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  const dates = rows.map((t) => t.date).sort();
  return {
    fileName: file.name,
    transactionsFound: rows.length,
    range: { from: dates[0], to: dates[dates.length - 1] },
    totalSpent: round2(sum(rows.map(netSpending))),
    totalIncome: round2(sum(rows.filter(isEarned).map((t) => t.amount))),
    alreadyInLedger: rows.length,
    newTransactions: 0,
    balanceCheck: 'passed',
  };
}

const HST = 0.13;

/**
 * Reads a receipt photo (the backend sends it to Claude and doesn't keep it) and finds
 * the expense it is for, if that's in the ledger already.
 */
export async function scanReceipt(image: PickedFile): Promise<ReceiptScan> {
  if (!USE_MOCK) {
    const form = new FormData();
    await appendFile(form, 'image', image);
    try {
      return await apiFetch<ReceiptScan>('/api/receipts/scan', { method: 'POST', body: form });
    } catch (e) {
      // A backend started before receipt scanning existed doesn't have the route.
      if (e instanceof ApiError && e.status === 404) {
        throw new ApiError(404, "The server doesn't support receipt scanning yet. Restart the backend and try again.");
      }
      throw e;
    }
  }
  await delay(2000);
  // Pretend every photo is the Gusto 101 dinner receipt, which is already in the ledger.
  const match = db.transactions.find((t) => t.merchant === 'Gusto 101') ?? null;
  const total = match?.amount ?? 84.6;
  const subtotal = round2(total / (1 + HST));
  return {
    merchant: match?.merchant ?? 'Gusto 101',
    date: match?.date ?? today(),
    subtotal,
    tax: round2(total - subtotal),
    taxLabel: 'HST 13%',
    total,
    currency: 'CAD',
    items: [{ description: 'Dinner', amount: subtotal }],
    category: 'Food',
    cardLast4: null,
    cardId: match?.cardId ?? null,
    matchedTransaction: match ? clone(match) : null,
    receiptId: null, // the mock doesn't keep photos
  };
}

/** A saved receipt (what was read, and the photo); null when there's none. Mock mode keeps no receipts. */
export async function getReceipt(id: string): Promise<Receipt | null> {
  if (USE_MOCK) return null;
  return apiFetchOrNull<Receipt>(`/api/receipts/${encodeURIComponent(id)}`);
}

/** Saves a scanned receipt with a transaction (e.g. the one it matched), replacing a receipt it had. */
export async function attachReceipt(receiptId: string, transactionId: string): Promise<Transaction> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return apiFetch<Transaction>(`/api/receipts/${encodeURIComponent(receiptId)}/attach`, {
    method: 'POST',
    body: JSON.stringify({ transactionId }),
  });
}

/** Removes a receipt and its photo; the transaction stays. */
export async function deleteReceipt(id: string): Promise<void> {
  if (USE_MOCK) throw new Error(NEEDS_BACKEND);
  return apiFetch<void>(`/api/receipts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Adds an expense from a receipt. The backend hides it again once a statement brings the same purchase. */
export async function addExpense(input: NewExpenseInput): Promise<Transaction> {
  if (!USE_MOCK) return apiFetch<Transaction>('/api/transactions', { method: 'POST', body: JSON.stringify(input) });
  await delay(400);
  const tx: Transaction = {
    ...input,
    id: `receipt_${Date.now().toString(16)}`,
    amount: round2(input.amount),
    rawDescription: `Receipt from ${input.merchant}`,
    isIncome: false,
    source: 'receipt',
  };
  db.transactions.push(tx);
  return clone(tx);
}

/** Deletes an expense added from a receipt (statement transactions can't be deleted). */
export async function deleteTransaction(id: string): Promise<void> {
  if (!USE_MOCK) return apiFetch<void>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await delay(300);
  db.transactions = db.transactions.filter((t) => t.id !== id || t.source !== 'receipt');
}
