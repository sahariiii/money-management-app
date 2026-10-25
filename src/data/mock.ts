// Mock data for the UI phase. Only lib/api.ts may import this file.
// Generated deterministically (seeded PRNG) so the demo looks the same on every run.

import { CARD_PRESETS } from '@/lib/card-presets';
import type {
  Alert,
  Budget,
  Card,
  Category,
  ChatMessage,
  ISODate,
  RecurringBill,
  RewardRule,
  Transaction,
} from '@/types';

/** The demo's "today". Data runs Aug 1 – Oct 22, 2026. */
export const DEMO_TODAY: ISODate = '2026-10-23';

const DEBIT = 'card_debit';
const VISA = 'card_visa';

// The Visa has the real CIBC Dividend Visa Infinite rates.
const CIBC_DIVIDEND = CARD_PRESETS.find((p) => p.id === 'cibc-dividend-visa-infinite')!;

export const cards: Card[] = [
  {
    id: DEBIT,
    institution: 'TD',
    type: 'debit',
    nickname: 'Everyday Debit',
    last4: '4821',
    accountLast4: '0457',
    annualFee: 0,
    interestRate: 0,
    cycleDay: 1,
  },
  {
    id: VISA,
    institution: 'CIBC',
    type: 'credit',
    nickname: CIBC_DIVIDEND.nickname,
    last4: '7392',
    annualFee: CIBC_DIVIDEND.annualFee,
    interestRate: CIBC_DIVIDEND.interestRate,
    cycleDay: 15,
  },
];

export const rewardRules: RewardRule[] = CIBC_DIVIDEND.rules.map((r) => ({ ...r, cardId: VISA }));

export const budgets: Budget[] = [
  { category: 'Groceries', monthlyLimit: 1050 },
  { category: 'Food', monthlyLimit: 400 },
  { category: 'Gas & EV charging', monthlyLimit: 150 },
  { category: 'Transport', monthlyLimit: 175 },
  { category: 'Car', monthlyLimit: 700 }, // ~76% in Oct, so Food stays the budget to watch
  { category: 'Shopping', monthlyLimit: 250 },
  { category: 'Health', monthlyLimit: 100 },
  { category: 'Entertainment', monthlyLimit: 100 },
];

// ---------------------------------------------------------------------------
// Transaction generation

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261023);
const between = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 100) / 100;
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];

type Draft = Omit<Transaction, 'id' | 'currency'>;

type Pattern = {
  merchant: string;
  raw: readonly string[];
  category: Category;
  min: number;
  max: number;
  /** Probability the purchase lands on the debit card. */
  debitShare: number;
  perMonth: number;
};

// Variable spending. Groceries mostly on debit so the optimizer has something to say.
const PATTERNS: Pattern[] = [
  { merchant: 'Costco', raw: ['COSTCO WHOLESALE W535', 'COSTCO WHOLESALE W535 TORONTO ON'], category: 'Groceries', min: 140, max: 260, debitShare: 0.9, perMonth: 2 },
  { merchant: 'Loblaws', raw: ['LOBLAWS #1027', 'LOBLAW CO #1027 TORONTO'], category: 'Groceries', min: 45, max: 130, debitShare: 0.85, perMonth: 3 },
  { merchant: 'No Frills', raw: ["NOFRILLS JOE'S #3631", 'NO FRILLS #3631 TORONTO ON'], category: 'Groceries', min: 30, max: 90, debitShare: 0.9, perMonth: 3 },
  { merchant: 'Metro', raw: ['METRO 612 TORONTO ON'], category: 'Groceries', min: 25, max: 70, debitShare: 0.3, perMonth: 1 },

  { merchant: 'Tim Hortons', raw: ['SQ *TIM HORTONS #1234', 'TIM HORTONS #2291'], category: 'Food', min: 3, max: 11, debitShare: 0.5, perMonth: 4 },
  { merchant: 'Starbucks', raw: ['STARBUCKS 800-782-7282'], category: 'Food', min: 5, max: 9, debitShare: 0.2, perMonth: 2 },
  { merchant: 'Uber Eats', raw: ['UBER *EATS PENDING', 'UBER* EATS HELP.UBER.COM'], category: 'Food', min: 22, max: 45, debitShare: 0.1, perMonth: 2 },
  { merchant: 'DoorDash', raw: ['DOORDASH*PIZZAPIZZA'], category: 'Food', min: 18, max: 34, debitShare: 0.1, perMonth: 1 },
  { merchant: 'Pai Northern Thai Kitchen', raw: ['PAI NORTHERN THAI KIT'], category: 'Food', min: 38, max: 65, debitShare: 0.1, perMonth: 1 },
  { merchant: "McDonald's", raw: ["MCDONALD'S #40213"], category: 'Food', min: 9, max: 16, debitShare: 0.6, perMonth: 1 },

  { merchant: 'PRESTO', raw: ['PRESTO FARE/T7HD9Q', 'PRESTO AUTOLOAD'], category: 'Transport', min: 20, max: 50, debitShare: 0.3, perMonth: 2 },
  { merchant: 'Uber', raw: ['UBER *TRIP HELP.UBER.COM'], category: 'Transport', min: 14, max: 32, debitShare: 0.1, perMonth: 2 },
  { merchant: 'Petro-Canada', raw: ['PETRO-CANADA 98543'], category: 'Gas & EV charging', min: 45, max: 70, debitShare: 0.4, perMonth: 2 },

  { merchant: 'Amazon', raw: ['AMZN Mktp CA*2K4L19RT2', 'AMAZON.CA*RT5YH21K3'], category: 'Shopping', min: 15, max: 90, debitShare: 0.2, perMonth: 2 },
  { merchant: 'Canadian Tire', raw: ['CDN TIRE STORE #00123'], category: 'Shopping', min: 20, max: 110, debitShare: 0.3, perMonth: 1 },
  { merchant: 'Winners', raw: ['WINNERS #212'], category: 'Shopping', min: 25, max: 80, debitShare: 0.2, perMonth: 1 },

  { merchant: 'Shoppers Drug Mart', raw: ['SHOPPERS DRUG MART #0821'], category: 'Health', min: 12, max: 45, debitShare: 0.4, perMonth: 1 },

  { merchant: 'Cineplex', raw: ['CINEPLEX ENTERTAINMENT'], category: 'Entertainment', min: 18, max: 40, debitShare: 0.1, perMonth: 1 },
  { merchant: 'Steam', raw: ['STEAMGAMES.COM 4259522985'], category: 'Entertainment', min: 10, max: 60, debitShare: 0.1, perMonth: 1 },
];

// October eating-out is hand-picked so the Food budget lands at ~85% ($341.40 of $400).
const OCTOBER_FOOD: [day: number, raw: string, merchant: string, amount: number, cardId: string][] = [
  [2, 'SQ *TIM HORTONS #1234', 'Tim Hortons', 6.45, VISA],
  [3, 'UBER *EATS PENDING', 'Uber Eats', 41.8, VISA],
  [5, 'PAI NORTHERN THAI KIT', 'Pai Northern Thai Kitchen', 68.4, VISA],
  [7, 'SQ *TIM HORTONS #1234', 'Tim Hortons', 4.89, DEBIT],
  [9, 'DOORDASH*PIZZAPIZZA', 'DoorDash', 32.15, VISA],
  [10, 'STARBUCKS 800-782-7282', 'Starbucks', 7.65, VISA],
  [12, 'UBER* EATS HELP.UBER.COM', 'Uber Eats', 46.2, VISA],
  [14, 'TST* GUSTO 101 TORONTO', 'Gusto 101', 84.6, VISA],
  [16, "MCDONALD'S #40213", "McDonald's", 13.79, DEBIT],
  [18, 'SQ *TIM HORTONS #1234', 'Tim Hortons', 8.12, VISA],
  [20, 'UBER *EATS PENDING', 'Uber Eats', 27.35, VISA],
];

const MONTHS = [
  { ym: '2026-08', lastDay: 31 },
  { ym: '2026-09', lastDay: 30 },
  { ym: '2026-10', lastDay: 22 }, // up to the day before DEMO_TODAY
];

const PAYDAYS = ['2026-08-07', '2026-08-21', '2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16'];

const day = (ym: string, d: number): ISODate => `${ym}-${String(d).padStart(2, '0')}`;

function fixedMonthly(ym: string): Draft[] {
  const rogers = ym === '2026-10' ? 200 : 65;
  const hydro = { '2026-08': 78.42, '2026-09': 71.1, '2026-10': 88.95 }[ym] ?? 75;
  const bill = (d: number, rawDescription: string, merchant: string, category: Category, amount: number, cardId: string): Draft => ({
    date: day(ym, d),
    amount,
    rawDescription,
    merchant,
    category,
    cardId,
    isIncome: false,
  });
  return [
    bill(1, `INTERAC E-TRF SENT RENT ${monthAbbr(ym)} LANDLORD`, 'Rent', 'Housing', 1850, DEBIT),
    bill(3, 'TOYOTA FINANCIAL SVCS PAD', 'Toyota Financial', 'Car', 389.12, DEBIT),
    bill(5, 'INTACT INS AUTO PREM 1-866-464-2424', 'Intact Insurance', 'Car', 142.5, DEBIT),
    bill(8, 'FIDO MOBILE 800-724-3436', 'Fido', 'Phone & Internet', 55, VISA),
    bill(10, 'ROGERS COMMUNICATIONS 888-764-3771', 'Rogers', 'Phone & Internet', rogers, VISA),
    bill(12, 'NETFLIX.COM 866-579-7172', 'Netflix', 'Subscriptions', 18.99, VISA),
    bill(18, 'TORONTO HYDRO-ELEC SYS PAP', 'Toronto Hydro', 'Utilities', hydro, DEBIT),
    bill(20, 'Spotify P2A9B3C4D5', 'Spotify', 'Subscriptions', 11.99, VISA),
  ];
}

function monthAbbr(ym: string) {
  return ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(ym.slice(5)) - 1];
}

function buildTransactions(): Transaction[] {
  const drafts: Draft[] = [];

  for (const date of PAYDAYS) {
    drafts.push({
      date,
      amount: 2412.55,
      rawDescription: 'PAYROLL DEP NORTHWIND TECH INC',
      merchant: 'Northwind Tech',
      category: 'Work',
      cardId: DEBIT,
      isIncome: true,
    });
  }

  for (const { ym, lastDay } of MONTHS) {
    drafts.push(...fixedMonthly(ym));

    for (const p of PATTERNS) {
      if (ym === '2026-10' && p.category === 'Food') continue;
      for (let i = 0; i < p.perMonth; i++) {
        drafts.push({
          date: day(ym, 1 + Math.floor(rand() * lastDay)),
          amount: between(p.min, p.max),
          rawDescription: pick(p.raw),
          merchant: p.merchant,
          category: p.category,
          cardId: rand() < p.debitShare ? DEBIT : VISA,
          isIncome: false,
        });
      }
    }
  }

  for (const [d, rawDescription, merchant, amount, cardId] of OCTOBER_FOOD) {
    drafts.push({ date: day('2026-10', d), amount, rawDescription, merchant, category: 'Food', cardId, isIncome: false });
  }

  for (const r of RETURNS) {
    const base = { rawDescription: r.raw, merchant: r.merchant, category: 'Shopping' as const, cardId: VISA };
    drafts.push({ ...base, date: r.bought, amount: r.paid, isIncome: false });
    drafts.push({ ...base, date: r.returned, amount: r.back, isIncome: true });
  }

  const txs = drafts
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t, i) => ({ ...t, id: `tx_${String(i + 1).padStart(4, '0')}`, currency: 'CAD' }));
  return linkReturns(txs);
}

// Returns: a Winners purchase returned in full, a Canadian Tire one partly. They come after the
// random patterns, so the rest of the demo stays the same.
const RETURNS = [
  { merchant: 'Winners', raw: 'WINNERS #212', bought: '2026-10-04', returned: '2026-10-09', paid: 79.99, back: 79.99 },
  { merchant: 'Canadian Tire', raw: 'CDN TIRE STORE #00123', bought: '2026-09-12', returned: '2026-09-20', paid: 89.97, back: 29.99 },
];

/** Links each RETURNS refund to its purchase, as the backend's link_refunds does for real statements. */
function linkReturns(txs: Transaction[]): Transaction[] {
  const find = (merchant: string, date: ISODate, amount: number, isIncome: boolean) =>
    txs.find((t) => t.merchant === merchant && t.date === date && t.amount === amount && t.isIncome === isIncome)!;
  for (const r of RETURNS) {
    const purchase = find(r.merchant, r.bought, r.paid, false);
    const refund = find(r.merchant, r.returned, r.back, true);
    refund.refundOf = purchase.id;
    purchase.refundedAmount = r.back;
    purchase.refundIds = [refund.id];
  }
  return txs;
}

export const transactions: Transaction[] = buildTransactions();

// ---------------------------------------------------------------------------
// Recurring bills and alerts, derived from the transactions above.

function nextMonth(date: ISODate): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, d)); // month index m = following month
  return next.toISOString().slice(0, 10);
}

function latest(merchant: string) {
  const matches = transactions.filter((t) => t.merchant === merchant);
  return matches[matches.length - 1];
}

const BILLS: Omit<RecurringBill, 'nextDue' | 'lastAmount'>[] = [
  { id: 'bill_rogers', merchant: 'Rogers', expectedAmount: 65, interval: 'monthly' },
  { id: 'bill_fido', merchant: 'Fido', expectedAmount: 55, interval: 'monthly' },
  { id: 'bill_netflix', merchant: 'Netflix', expectedAmount: 18.99, interval: 'monthly' },
  { id: 'bill_spotify', merchant: 'Spotify', expectedAmount: 11.99, interval: 'monthly' },
  { id: 'bill_hydro', merchant: 'Toronto Hydro', expectedAmount: 80, interval: 'monthly' },
  { id: 'bill_car_lease', merchant: 'Toyota Financial', expectedAmount: 389.12, interval: 'monthly' },
  { id: 'bill_car_insurance', merchant: 'Intact Insurance', expectedAmount: 142.5, interval: 'monthly' },
];

export const recurringBills: RecurringBill[] = BILLS.map((b) => {
  const last = latest(b.merchant);
  return { ...b, lastAmount: last.amount, nextDue: nextMonth(last.date) };
});

const rogersOct = latest('Rogers');
const octFoodSpent = transactions
  .filter((t) => t.category === 'Food' && t.date.startsWith('2026-10'))
  .reduce((sum, t) => sum + t.amount, 0);
const foodLimit = budgets.find((b) => b.category === 'Food')!.monthlyLimit;

// ---------------------------------------------------------------------------
// Earlier conversations with the assistant, so the chat history isn't empty.

const msg = (id: string, role: ChatMessage['role'], createdAt: string, text: string, summary?: ChatMessage['summary']): ChatMessage => ({
  id,
  role,
  createdAt,
  text,
  ...(summary && { summary }),
});

export const chats: { id: string; title: string; messages: ChatMessage[] }[] = [
  {
    id: 'chat_demo_rogers',
    title: 'Why my Rogers bill jumped',
    messages: [
      msg('msg_demo_1', 'user', '2026-10-21T18:02:00Z', 'Why was my phone bill so high this month?'),
      msg(
        'msg_demo_2',
        'assistant',
        '2026-10-21T18:02:20Z',
        'Rogers charged $200.00 on October 10, up from the usual $65.00 in August and September. Nothing else on your phone and internet bills changed. It is worth calling Rogers to ask what the extra $135.00 is for.',
        { value: '+$135.00', label: 'Rogers above usual in October', tone: 'expense' },
      ),
    ],
  },
  {
    id: 'chat_demo_groceries',
    title: 'Best card for groceries',
    messages: [
      msg('msg_demo_3', 'user', '2026-10-12T09:15:00Z', 'Which card should I use for groceries?'),
      msg(
        'msg_demo_4',
        'assistant',
        '2026-10-12T09:15:18Z',
        'Your CIBC Dividend Visa Infinite pays 4% on groceries, and your debit card pays nothing. Most of your grocery runs (Costco, Loblaws, No Frills) went on debit, so switching them to the Visa would earn about $30 a month.',
      ),
    ],
  },
];

export const alerts: Alert[] = [
  {
    id: 'alert_rogers_oct',
    type: 'bill_change',
    message: `Rogers charged $${rogersOct.amount.toFixed(2)} this month, up from your usual $65.00.`,
    transactionId: rogersOct.id,
    status: 'open',
  },
  {
    id: 'alert_food_oct',
    type: 'budget',
    message: `You've used ${Math.round((octFoodSpent / foodLimit) * 100)}% of your Food budget with 8 days left in October.`,
    transactionId: null,
    status: 'open',
  },
  {
    id: 'alert_dup_sep',
    type: 'duplicate',
    message: 'Two identical Uber Eats charges in September looked like a duplicate.',
    transactionId: null,
    status: 'dismissed',
  },
];
