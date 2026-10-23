// The only data access layer for screens.
//
// With EXPO_PUBLIC_API_URL set (see .env.local), transactions, cards and
// statements come from the FastAPI backend in backend/, and what the backend
// doesn't have yet (budgets, bills, alerts, card rewards, the assistant) is
// empty. Without it, everything is mock data from an in-memory copy.
// Summaries and budgets are computed here from the transactions either way.

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import {
  DEMO_TODAY,
  alerts as seedAlerts,
  budgets as seedBudgets,
  cards as seedCards,
  recurringBills as seedBills,
  rewardRules as seedRewardRules,
  transactions as seedTransactions,
} from '@/data/mock';
import { lastDayOf, shiftMonth, weekStart } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
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
  DateRange,
  ISODate,
  MerchantSpend,
  MonthTotals,
  OptimizerCategory,
  RangePreset,
  RecurringBill,
  RewardRule,
  SpendSummary,
  Statement,
  Transaction,
  TransactionFilters,
  WeekTotals,
  YearMonth,
} from '@/types';

// ---------------------------------------------------------------------------
// Backend

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
const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN;
const live = API_URL !== null;

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    // Screens only show a spinner, so say where to look.
    console.warn(`Can't reach the backend at ${API_URL}. Is it running? (${e})`);
    throw e;
  }
  if (!res.ok) {
    // FastAPI errors are {"detail": "..."} or {"detail": {"code": ..., "message": ...}}.
    const detail = (await res.json().catch(() => null))?.detail;
    const message = typeof detail === 'string' ? detail : (detail?.message ?? `${res.status} ${res.statusText}`);
    throw new ApiError(res.status, message, detail?.code);
  }
  return res.json() as Promise<T>;
}

/** Like request, but null when the backend says 404. */
async function requestOrNull<T>(path: string): Promise<T | null> {
  try {
    return await request<T>(path);
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
// In-memory data. With mock data, edits (recategorize, dismiss) persist for the
// session. With the backend, it only holds what the backend doesn't serve yet,
// which stays empty.

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const db: {
  transactions: Transaction[];
  cards: Card[];
  budgets: Budget[];
  recurringBills: RecurringBill[];
  rewardRules: RewardRule[];
  alerts: Alert[];
  /** merchant -> category, applied when the user picks "always for this merchant". */
  merchantRules: Record<string, Category>;
} = live
  ? { transactions: [], cards: [], budgets: [], recurringBills: [], rewardRules: [], alerts: [], merchantRules: {} }
  : {
      transactions: clone(seedTransactions),
      cards: seedCards,
      budgets: seedBudgets,
      recurringBills: seedBills,
      rewardRules: seedRewardRules,
      alerts: clone(seedAlerts),
      merchantRules: {},
    };

/** Fake network latency for mock data. */
const delay = (ms = 300) => (live ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms)));
const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

let allInFlight: Promise<Transaction[]> | null = null;

/** Every transaction, for the summaries computed below. */
async function allTransactions(): Promise<Transaction[]> {
  if (live) {
    // Screens load several summaries at once; they share one request.
    allInFlight ??= request<Transaction[]>('/api/transactions').finally(() => (allInFlight = null));
    return allInFlight;
  }
  await delay();
  return db.transactions;
}

// ---------------------------------------------------------------------------
// Dates

/** The demo date with mock data, the real date with the backend. */
export function today(): ISODate {
  if (!live) return DEMO_TODAY;
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
    case 'year-to-date':
      return { from: `${today().slice(0, 4)}-01-01`, to: today() };
  }
}

const inRange = (t: Transaction, { from, to }: DateRange) => t.date >= from && t.date <= to;
const expenses = (txs: Transaction[]) => txs.filter((t) => !t.isIncome);

function daysBetween({ from, to }: DateRange) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// Cards & transactions

export async function getCards(): Promise<Card[]> {
  if (live) return request<Card[]>('/api/cards');
  await delay();
  return clone(db.cards);
}

export async function getTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
  if (live) return request<Transaction[]>(`/api/transactions${query(filters)}`);
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
  if (live) return requestOrNull<Transaction>(`/api/transactions/${encodeURIComponent(id)}`);
  await delay(150);
  const tx = db.transactions.find((t) => t.id === id);
  return tx ? clone(tx) : null;
}

export async function updateCategory(
  id: string,
  category: Category,
  alwaysForMerchant = false,
): Promise<CategoryUpdate> {
  if (live) {
    return request<CategoryUpdate>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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

function summarize(all: Transaction[], range: DateRange): SpendSummary {
  const txs = all.filter((t) => inRange(t, range));
  const spent = expenses(txs);
  const totalSpent = sum(spent.map((t) => t.amount));
  const totalIncome = sum(txs.filter((t) => t.isIncome).map((t) => t.amount));

  const byCat = new Map<Category, { amount: number; count: number }>();
  const byMerchant = new Map<string, { amount: number; count: number }>();
  for (const t of spent) {
    const c = byCat.get(t.category) ?? { amount: 0, count: 0 };
    byCat.set(t.category, { amount: c.amount + t.amount, count: c.count + 1 });
    const m = byMerchant.get(t.merchant) ?? { amount: 0, count: 0 };
    byMerchant.set(t.merchant, { amount: m.amount + t.amount, count: m.count + 1 });
  }

  const byMonthMap = new Map<YearMonth, MonthTotals>();
  for (const t of txs) {
    const month = t.date.slice(0, 7);
    const row = byMonthMap.get(month) ?? { month, spent: 0, income: 0 };
    if (t.isIncome) row.income += t.amount;
    else row.spent += t.amount;
    byMonthMap.set(month, row);
  }

  const byCategory: CategorySpend[] = [...byCat]
    .map(([category, v]) => ({
      category,
      amount: round2(v.amount),
      count: v.count,
      share: totalSpent ? round2(v.amount / totalSpent) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const topMerchants: MerchantSpend[] = [...byMerchant]
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
  for (const t of expenses(txs.filter((t) => inRange(t, r)))) {
    if (excludeCategories.includes(t.category)) continue;
    const w = weekStart(t.date);
    weeks.set(w, (weeks.get(w) ?? 0) + t.amount);
  }
  return [...weeks]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([start, spent]) => ({ weekStart: start, spent: round2(spent) }));
}

function addDays(date: ISODate, days: number): ISODate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function budgetStatus(all: Transaction[], month: YearMonth): BudgetStatus[] {
  const range = { from: `${month}-01`, to: lastDayOf(month) };
  const spent = expenses(all.filter((t) => inRange(t, range)));
  return db.budgets.map((b) => {
    const total = sum(spent.filter((t) => t.category === b.category).map((t) => t.amount));
    return {
      ...b,
      month,
      spent: round2(total),
      remaining: round2(b.monthlyLimit - total),
      ratio: round2(total / b.monthlyLimit),
    };
  });
}

export async function getBudgets(month: YearMonth = currentMonth()): Promise<BudgetStatus[]> {
  return budgetStatus(await allTransactions(), month);
}

// ---------------------------------------------------------------------------
// Bills & alerts

export async function getRecurringBills(): Promise<RecurringBill[]> {
  await delay();
  return clone(db.recurringBills).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
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

/** Categories that can't realistically go on a credit card. */
const NOT_CARD_PAYABLE: Category[] = ['Housing', 'Income'];

function ruleFor(cardId: string, category: Category) {
  const rules = db.rewardRules.filter((r) => r.cardId === cardId);
  return rules.find((r) => r.category === category) ?? rules.find((r) => r.category === '*');
}

/**
 * Cashback for putting `amount` on a card. Caps are monthly spend limits per rule;
 * spend past the cap earns the card's '*' rate. `usage` tracks spend per rule/month
 * and is only updated when `commit` is true.
 */
function rewardFor(
  cardId: string,
  t: Transaction,
  usage: Map<string, number>,
  commit: boolean,
): number {
  const rule = ruleFor(cardId, t.category);
  if (!rule) return 0;
  let eligible = t.amount;
  if (rule.cap !== null) {
    const key = `${cardId}|${rule.category}|${t.date.slice(0, 7)}`;
    const used = usage.get(key) ?? 0;
    eligible = Math.max(0, Math.min(t.amount, rule.cap - used));
    if (commit) usage.set(key, used + t.amount);
  }
  const base = db.rewardRules.find((r) => r.cardId === cardId && r.category === '*');
  const fallbackRate = base && base !== rule ? base.ratePercent : 0;
  return (eligible * rule.ratePercent + (t.amount - eligible) * fallbackRate) / 100;
}

function optimize(all: Transaction[], cards: Card[], range: DateRange): CardOptimizer {
  const txs = expenses(all.filter((t) => inRange(t, range)))
    .filter((t) => !NOT_CARD_PAYABLE.includes(t.category))
    .sort((a, b) => a.date.localeCompare(b.date));

  const actualUsage = new Map<string, number>();
  const bestUsage = new Map<string, number>();

  type Acc = { spent: number; earned: number; potential: number; byCard: Map<string, number>; bestByCard: Map<string, number> };
  const cats = new Map<Category, Acc>();
  const perCard = new Map<string, { spent: number; earned: number }>();

  for (const t of txs) {
    const earned = rewardFor(t.cardId, t, actualUsage, true);

    // Best case: the card that would have paid the most for this purchase.
    let bestCard = t.cardId;
    let bestReward = -1;
    for (const card of cards) {
      const r = rewardFor(card.id, t, bestUsage, false);
      if (r > bestReward) {
        bestReward = r;
        bestCard = card.id;
      }
    }
    rewardFor(bestCard, t, bestUsage, true);

    const acc = cats.get(t.category) ?? { spent: 0, earned: 0, potential: 0, byCard: new Map(), bestByCard: new Map() };
    acc.spent += t.amount;
    acc.earned += earned;
    acc.potential += bestReward;
    acc.byCard.set(t.cardId, (acc.byCard.get(t.cardId) ?? 0) + t.amount);
    acc.bestByCard.set(bestCard, (acc.bestByCard.get(bestCard) ?? 0) + t.amount);
    cats.set(t.category, acc);

    const c = perCard.get(t.cardId) ?? { spent: 0, earned: 0 };
    perCard.set(t.cardId, { spent: c.spent + t.amount, earned: c.earned + earned });
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
  const yearFactor = 365 / daysBetween(range);

  const cardName = (id: string) => {
    const card = cards.find((c) => c.id === id);
    return card ? `${card.nickname} (•••• ${card.last4})` : id;
  };

  const tips = byCategory
    .filter((c) => c.missed >= 1)
    .slice(0, 3)
    .map((c) => `Use ${cardName(c.bestCardId)} for ${c.category}: you'd have earned ${formatMoney(c.missed)} more in this period.`);

  for (const card of cards.filter((c) => c.annualFee > 0)) {
    const perYear = sum(byCategory.filter((c) => c.bestCardId === card.id).map((c) => c.potential)) * yearFactor;
    tips.push(
      perYear >= card.annualFee
        ? `Used for the right categories, ${card.nickname} earns about ${formatMoney(perYear)}/yr, covering its ${formatMoney(card.annualFee)} fee.`
        : `${card.nickname} would earn about ${formatMoney(perYear)}/yr at your spending, less than its ${formatMoney(card.annualFee)} fee.`,
    );
  }

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
    tips,
  };
}

export async function getCardOptimizer(period: RangePreset | DateRange = 'last-3-months'): Promise<CardOptimizer> {
  const range = resolveRange(period);
  // The backend has no card reward rules yet, so there is nothing to optimize.
  if (live) return { range, earned: 0, potential: 0, missed: 0, missedPerYear: 0, byCategory: [], byCard: [], tips: [] };
  const [txs, cards] = await Promise.all([allTransactions(), getCards()]);
  return optimize(txs, cards, range);
}

// ---------------------------------------------------------------------------
// Statements (backend only: mock data has none)

/** A picked file, as expo-document-picker returns it; `file` is set on web. */
export type UploadFile = { uri: string; name: string; mimeType?: string; file?: File };

const NEEDS_BACKEND = 'Statements need the backend: set EXPO_PUBLIC_API_URL in .env.local.';

/** Newest first. */
export async function getStatements(): Promise<Statement[]> {
  return live ? request<Statement[]>('/api/statements') : [];
}

export async function getStatement(id: string): Promise<Statement | null> {
  return live ? requestOrNull<Statement>(`/api/statements/${encodeURIComponent(id)}`) : null;
}

/**
 * Uploads a PDF statement. The backend reads and categorizes it in the
 * background: poll getStatement(id) until its status isn't 'processing'.
 * Throws an ApiError with code 'password_required' when the PDF needs a
 * password (or the one given was wrong); ask for it and upload again.
 */
export async function uploadStatement(file: UploadFile, password?: string): Promise<Statement> {
  if (!live) throw new Error(NEEDS_BACKEND);
  const form = new FormData();
  if (file.file) form.append('file', file.file, file.name);
  // React Native's fetch uploads a { uri, name, type } part from the file on the device.
  else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/pdf' } as unknown as Blob);
  if (password) form.append('password', password);
  return request<Statement>('/api/statements', { method: 'POST', body: form });
}

/** Processes a statement again after it stopped short (status 'incomplete'). */
export async function processStatement(id: string): Promise<Statement> {
  if (!live) throw new Error(NEEDS_BACKEND);
  return request<Statement>(`/api/statements/${encodeURIComponent(id)}/process`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Assistant (canned answers computed from the mock data until the agent backend exists)

let messageSeq = 0;
const message = (role: ChatMessage['role'], text: string): ChatMessage => ({
  id: `msg_${Date.now()}_${messageSeq++}`,
  role,
  text,
  createdAt: new Date().toISOString(),
});

function onTrackAnswer(all: Transaction[]): string {
  const month = currentMonth();
  const dayOfMonth = Number(today().slice(8));
  const daysLeft = Number(lastDayOf(month).slice(8)) - dayOfMonth;
  const prev = shiftMonth(month, -1);

  const thisMonth = summarize(all, { from: `${month}-01`, to: today() }).totalSpent;
  const lastMonthToDate = summarize(all, { from: `${prev}-01`, to: `${prev}-${today().slice(8)}` }).totalSpent;
  const diff = thisMonth - lastMonthToDate;

  const statuses = budgetStatus(all, month);
  const hot = statuses.filter((b) => b.ratio >= 0.8).sort((a, b) => b.ratio - a.ratio);

  const lines = [
    `You've spent ${formatMoney(thisMonth)} so far this month, ${formatMoney(Math.abs(diff))} ${diff >= 0 ? 'more' : 'less'} than at this point last month.`,
  ];
  if (hot.length === 0) {
    lines.unshift('Yes, you are on track.');
    lines.push('Every budget is under 80%.');
  } else {
    lines.unshift(hot.some((b) => b.ratio >= 1) ? 'Not quite.' : 'Mostly, with one thing to watch.');
    for (const b of hot) {
      lines.push(
        `${b.category}: ${formatMoney(b.spent)} of ${formatMoney(b.monthlyLimit)} (${Math.round(b.ratio * 100)}%) with ${daysLeft} days left.`,
      );
    }
    const others = statuses.length - hot.length;
    if (others > 0) lines.push(`Your other ${others} budgets are under 80%.`);
  }
  return lines.join(' ');
}

function restaurantsAnswer(all: Transaction[]): string {
  const range = { from: '2026-07-01', to: today() };
  const food = all.filter((t) => t.category === 'Food' && !t.isIncome && inRange(t, range));
  const total = sum(food.map((t) => t.amount));

  const months = new Map<YearMonth, number>();
  const merchants = new Map<string, number>();
  for (const t of food) {
    months.set(t.date.slice(0, 7), (months.get(t.date.slice(0, 7)) ?? 0) + t.amount);
    merchants.set(t.merchant, (merchants.get(t.merchant) ?? 0) + t.amount);
  }
  const monthName = (ym: YearMonth) =>
    new Date(`${ym}-01T12:00:00Z`).toLocaleString('en-CA', { month: 'long', timeZone: 'UTC' });
  const breakdown = [...months]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, amt]) => `${monthName(ym)} ${formatMoney(amt)}`)
    .join(', ');
  const [topMerchant, topAmount] = [...merchants].sort((a, b) => b[1] - a[1])[0] ?? ['none', 0];

  return (
    `Since July you've spent ${formatMoney(total)} on restaurants, cafés and takeout across ${food.length} purchases ` +
    `(${breakdown}; my records start in August). Your top spot is ${topMerchant} at ${formatMoney(topAmount)}.`
  );
}

const FALLBACK =
  "I'm still learning your habits. I can help with budgets, spending by category, upcoming bills and " +
  'which card to use. Try "Am I on track this month?" or "How much on restaurants since July?"';

export async function sendChatMessage(text: string): Promise<ChatMessage> {
  if (live) return message('assistant', "The assistant isn't connected to the backend yet.");
  await delay(900);
  const q = text.toLowerCase();
  let answer = FALLBACK;
  if (q.includes('on track')) answer = onTrackAnswer(db.transactions);
  else if (/restaurant|eating out|dining|takeout|take-out/.test(q)) answer = restaurantsAnswer(db.transactions);
  return message('assistant', answer);
}
