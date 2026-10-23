// The only data access layer for screens. Today it serves mock data from an
// in-memory copy; later each function becomes a fetch() to the FastAPI backend
// with the same signature.

import {
  DEMO_TODAY,
  alerts as seedAlerts,
  budgets as seedBudgets,
  cards as seedCards,
  recurringBills,
  rewardRules as seedRules,
  transactions as seedTransactions,
} from '@/data/mock';
import { addDays, daysFrom, lastDayOf, shiftMonth, weekStart } from '@/lib/dates';
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
  FeeCheck,
  ISODate,
  MerchantSpend,
  MonthTotals,
  NewCardInput,
  OptimizerCategory,
  PickedFile,
  RangePreset,
  ReceiptScan,
  RecurringBillStatus,
  RewardRule,
  SpendSummary,
  StatementUpload,
  Transaction,
  TransactionFilters,
  WeekTotals,
  YearMonth,
} from '@/types';

// ---------------------------------------------------------------------------
// In-memory "database" so edits (recategorize, dismiss, add card, chat) persist for the session.

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const db = {
  transactions: clone(seedTransactions),
  alerts: clone(seedAlerts),
  cards: clone(seedCards),
  rewardRules: clone(seedRules),
  budgets: clone(seedBudgets),
  chat: [] as ChatMessage[],
  /** merchant -> category, applied when the user picks "always for this merchant". */
  merchantRules: {} as Record<string, Category>,
};

const delay = (ms = 300) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Dates

/** Demo date. Becomes the real date once data is live. */
export function today(): ISODate {
  return DEMO_TODAY;
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

/** Days in a range, counting both ends. */
const daysIn = ({ from, to }: DateRange) => daysFrom(from, to) + 1;

// ---------------------------------------------------------------------------
// Cards & transactions

export async function getCards(): Promise<Card[]> {
  await delay();
  return clone(db.cards);
}

export async function getRewardRules(cardId?: string): Promise<RewardRule[]> {
  await delay(150);
  return clone(cardId ? db.rewardRules.filter((r) => r.cardId === cardId) : db.rewardRules);
}

export async function addCard(input: NewCardInput): Promise<Card> {
  await delay(500);
  const { rules, ...fields } = input;
  // Only ever keep the last 4 digits, whatever the caller passes.
  const card: Card = { ...fields, id: `card_${Date.now()}`, last4: fields.last4.replace(/\D/g, '').slice(-4) };
  db.cards.push(card);
  db.rewardRules.push(...rules.map((r) => ({ ...r, cardId: card.id })));
  return clone(card);
}

export async function getTransactions(filters: TransactionFilters = {}): Promise<Transaction[]> {
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
  await delay(150);
  const tx = db.transactions.find((t) => t.id === id);
  return tx ? clone(tx) : null;
}

export async function updateCategory(
  id: string,
  category: Category,
  alwaysForMerchant = false,
): Promise<CategoryUpdate> {
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

function summarize(range: DateRange): SpendSummary {
  const txs = db.transactions.filter((t) => inRange(t, range));
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
  await delay();
  return summarize(resolveRange(range));
}

/** Months that have any transactions, oldest first. */
export async function getMonths(): Promise<YearMonth[]> {
  await delay(100);
  return [...new Set(db.transactions.map((t) => t.date.slice(0, 7)))].sort();
}

/**
 * Spending per week (weeks start Monday). Rent is excluded by default so the
 * trend shows day-to-day spending instead of a spike every 1st of the month.
 */
export async function getWeeklySpend(
  range: RangePreset | DateRange = 'last-3-months',
  excludeCategories: Category[] = ['Housing'],
): Promise<WeekTotals[]> {
  await delay();
  const resolved = resolveRange(range);
  // Start at the first full week so a partial first week doesn't read as a dip.
  const firstMonday = weekStart(resolved.from) === resolved.from ? resolved.from : addDays(weekStart(resolved.from), 7);
  const r = { ...resolved, from: firstMonday };
  const weeks = new Map<ISODate, number>();
  // Seed every week in range so quiet weeks show as 0 instead of disappearing.
  for (let w = r.from; w <= r.to; w = addDays(w, 7)) weeks.set(w, 0);
  for (const t of expenses(db.transactions.filter((t) => inRange(t, r)))) {
    if (excludeCategories.includes(t.category)) continue;
    const w = weekStart(t.date);
    weeks.set(w, (weeks.get(w) ?? 0) + t.amount);
  }
  return [...weeks]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([start, spent]) => ({ weekStart: start, spent: round2(spent) }));
}

function budgetStatus(month: YearMonth): BudgetStatus[] {
  const range = { from: `${month}-01`, to: lastDayOf(month) };
  const spent = expenses(db.transactions.filter((t) => inRange(t, range)));
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
  await delay();
  return budgetStatus(month);
}

/** Creates or updates the monthly limit for a category. */
export async function setBudget(category: Category, monthlyLimit: number): Promise<Budget> {
  await delay(250);
  if (!(monthlyLimit > 0)) throw new Error('Budget limit must be above 0');
  const limit = round2(monthlyLimit);
  const existing = db.budgets.find((b) => b.category === category);
  if (existing) existing.monthlyLimit = limit;
  else db.budgets.push({ category, monthlyLimit: limit });
  return { category, monthlyLimit: limit };
}

// ---------------------------------------------------------------------------
// Bills & alerts

/** A bill counts as unusual when the last charge is 25%+ above the usual amount. */
const UNUSUAL_BILL_CHANGE = 0.25;

export async function getRecurringBills(): Promise<RecurringBillStatus[]> {
  await delay();
  return recurringBills
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

function optimize(range: DateRange): CardOptimizer {
  const txs = expenses(db.transactions.filter((t) => inRange(t, range)))
    .filter((t) => !NOT_CARD_PAYABLE.includes(t.category))
    .sort((a, b) => a.date.localeCompare(b.date));

  const actualUsage = new Map<string, number>();
  const bestUsage = new Map<string, number>();

  type Acc = { spent: number; earned: number; potential: number; byCard: Map<string, number>; bestByCard: Map<string, number> };
  const cats = new Map<Category, Acc>();
  const perCard = new Map<string, { spent: number; earned: number }>();
  const potentialByCard = new Map<string, number>();

  for (const t of txs) {
    const earned = rewardFor(t.cardId, t, actualUsage, true);

    // Best case: the card that would have paid the most for this purchase.
    let bestCard = t.cardId;
    let bestReward = -1;
    for (const card of db.cards) {
      const r = rewardFor(card.id, t, bestUsage, false);
      if (r > bestReward) {
        bestReward = r;
        bestCard = card.id;
      }
    }
    rewardFor(bestCard, t, bestUsage, true);
    potentialByCard.set(bestCard, (potentialByCard.get(bestCard) ?? 0) + bestReward);

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
  const yearFactor = 365 / daysIn(range);

  const cardName = (id: string) => {
    const card = db.cards.find((c) => c.id === id);
    return card ? `${card.nickname} (•••• ${card.last4})` : id;
  };

  const tips = byCategory
    .filter((c) => c.missed >= 1)
    .slice(0, 3)
    .map((c) => `Use ${cardName(c.bestCardId)} for ${c.category}: you'd have earned ${formatMoney(c.missed)} more in this period.`);

  const feeChecks: FeeCheck[] = db.cards
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
    byCard: db.cards.map((c) => {
      const v = perCard.get(c.id) ?? { spent: 0, earned: 0 };
      return { cardId: c.id, spent: round2(v.spent), earned: round2(v.earned) };
    }),
    feeChecks,
    tips,
  };
}

export async function getCardOptimizer(period: RangePreset | DateRange = 'last-3-months'): Promise<CardOptimizer> {
  await delay();
  return optimize(resolveRange(period));
}

// ---------------------------------------------------------------------------
// Assistant (canned answers computed from the data until the agent backend exists)

type Answer = Pick<ChatMessage, 'text' | 'summary'>;

let messageSeq = 0;
const message = (role: ChatMessage['role'], answer: Answer): ChatMessage => ({
  id: `msg_${Date.now()}_${messageSeq++}`,
  role,
  createdAt: new Date().toISOString(),
  ...answer,
});

function onTrackAnswer(): Answer {
  const month = currentMonth();
  const dayOfMonth = Number(today().slice(8));
  const daysLeft = Number(lastDayOf(month).slice(8)) - dayOfMonth;
  const prev = shiftMonth(month, -1);

  const thisMonth = summarize({ from: `${month}-01`, to: today() }).totalSpent;
  const lastMonthToDate = summarize({ from: `${prev}-01`, to: `${prev}-${today().slice(8)}` }).totalSpent;
  const diff = thisMonth - lastMonthToDate;

  const statuses = budgetStatus(month);
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

function restaurantsAnswer(): Answer {
  const range = { from: '2026-07-01', to: today() };
  const food = db.transactions.filter((t) => t.category === 'Food' && !t.isIncome && inRange(t, range));
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

  return {
    text:
      `Since July you've spent ${formatMoney(total)} on restaurants, cafés and takeout across ${food.length} purchases ` +
      `(${breakdown}; my records start in August). Your top spot is ${topMerchant} at ${formatMoney(topAmount)}.`,
    summary: { value: formatMoney(total), label: 'Restaurants & takeout since July', tone: 'expense' },
  };
}

function cardAnswer(question: string): Answer {
  const opt = optimize(resolveRange('this-month'));
  const asked = opt.byCategory.find((c) => question.includes(c.category.toLowerCase()));
  const pick = asked ?? opt.byCategory[0];
  if (!pick) return { text: "You haven't spent anything on cards this month yet." };

  const best = db.cards.find((c) => c.id === pick.bestCardId);
  const rate = best ? ruleFor(best.id, pick.category)?.ratePercent ?? 0 : 0;
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

export async function getChatHistory(): Promise<ChatMessage[]> {
  await delay(150);
  return clone(db.chat);
}

/** Stores the user's message, then returns (and stores) the assistant's reply. */
export async function sendChatMessage(text: string): Promise<ChatMessage> {
  db.chat.push(message('user', { text }));
  await delay(1200);
  const q = text.toLowerCase();
  let answer = FALLBACK;
  if (q.includes('on track')) answer = onTrackAnswer();
  else if (/restaurant|eating out|dining|takeout|take-out/.test(q)) answer = restaurantsAnswer();
  else if (/\bcard\b|cashback|rewards?/.test(q)) answer = cardAnswer(q);
  const reply = message('assistant', answer);
  db.chat.push(reply);
  return clone(reply);
}

// ---------------------------------------------------------------------------
// Uploads (mocked: file contents are never read)

export async function uploadStatement(file: PickedFile): Promise<StatementUpload> {
  await delay(2400);
  // Pretend the statement holds the 40 most recent ledger rows, so everything matches.
  const rows = [...db.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  const dates = rows.map((t) => t.date).sort();
  return {
    fileName: file.name,
    transactionsFound: rows.length,
    range: { from: dates[0], to: dates[dates.length - 1] },
    totalSpent: round2(sum(rows.filter((t) => !t.isIncome).map((t) => t.amount))),
    totalIncome: round2(sum(rows.filter((t) => t.isIncome).map((t) => t.amount))),
    alreadyInLedger: rows.length,
    newTransactions: 0,
    balanceCheck: 'passed',
  };
}

const HST = 0.13;

export async function scanReceipt(image: PickedFile): Promise<ReceiptScan> {
  void image;
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
    matchedTransaction: match ? clone(match) : null,
  };
}
