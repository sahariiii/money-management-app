// Domain types. These mirror the future SurrealDB tables so lib/api.ts can be
// swapped to real fetch calls without touching screens.

export const EXPENSE_CATEGORIES = [
  'Groceries',
  'Food', // restaurants, cafés, takeout and delivery
  'Gas & EV charging',
  'Transport', // transit, taxis and rideshare
  'Car', // insurance, financing and leases, maintenance, parking, tolls
  'Shopping',
  'Health',
  'Entertainment',
  'Subscriptions',
  'Phone & Internet',
  'Utilities',
  'Housing',
  'Fees & interest', // bank and card fees, interest charged; they earn no cashback
  'Other',
] as const;

/** Where money comes from. Refunds keep the spending category they came back to. */
export const INCOME_CATEGORIES = ['Work', 'Tax refund', 'Side income', 'Reimbursement', 'Other income'] as const;

export const CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES] as const;

export type Category = (typeof CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const isIncomeCategory = (c: Category): c is IncomeCategory => (INCOME_CATEGORIES as readonly Category[]).includes(c);

/** ISO date, YYYY-MM-DD. */
export type ISODate = string;
/** Calendar month, YYYY-MM. */
export type YearMonth = string;

export type Card = {
  id: string;
  institution: string;
  type: 'debit' | 'credit';
  nickname: string;
  /** Last 4 digits only. Full card numbers are never stored. */
  last4: string;
  /** Last 4 digits of the bank account the card belongs to, if the user gave it. Never the full number. */
  accountLast4?: string;
  annualFee: number;
  /** APR in percent; 0 for debit. */
  interestRate: number;
  /** Day of month the statement closes. */
  cycleDay: number;
  /** The backend's stand-in card, listed until the user adds one; it can't be edited or deleted. */
  isPlaceholder?: boolean;
};

export type RewardRule = {
  cardId: string;
  /** '*' applies to every category without its own rule. */
  category: Category | '*';
  ratePercent: number;
  /** Monthly spend (in dollars) that earns this rate; null = uncapped. */
  cap: number | null;
};

export type Transaction = {
  id: string;
  date: ISODate;
  /** Always positive; direction comes from isIncome. */
  amount: number;
  currency: string;
  rawDescription: string;
  merchant: string;
  category: Category;
  /** A card's id, or CASH_CARD_ID. */
  cardId: string;
  isIncome: boolean;
  /** receipt: added from a scanned receipt (the user can delete it). Statement rows otherwise. */
  source?: 'statement' | 'receipt';
  /** The statement it is on (Statement.id); null for receipt expenses and in mock mode. */
  statementId?: string | null;
  /** A scanned receipt saved with it; load it with getReceipt. */
  receiptId?: string | null;
  // Returns (lib/refunds.ts). A refund is money in under a spending category: money back for a
  // purchase, never income.
  /** On a refund: the purchase it returns, when the ledger has it. */
  refundOf?: string | null;
  /** On a purchase: how much of it came back in refunds. */
  refundedAmount?: number;
  /** On a purchase: the refunds that returned it, oldest first. */
  refundIds?: string[];
};

/** cardId of an expense paid in cash, or with anything that isn't one of the user's cards. */
export const CASH_CARD_ID = 'cash';

export type Budget = {
  category: Category;
  monthlyLimit: number;
};

/** The user's one savings goal: save targetAmount between startDate and targetDate. */
export type SavingsGoal = {
  name: string;
  targetAmount: number;
  /** The day it was set. Saving counts from here: money in minus money out. */
  startDate: ISODate;
  targetDate: ISODate;
};

export type RecurringBill = {
  id: string;
  merchant: string;
  expectedAmount: number;
  interval: 'weekly' | 'biweekly' | 'monthly' | 'yearly';
  nextDue: ISODate;
  lastAmount: number;
};

export type Alert = {
  id: string;
  type: 'bill_change' | 'budget' | 'duplicate' | 'unusual';
  message: string;
  transactionId: string | null;
  status: 'open' | 'dismissed';
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  /** Optional headline number shown as a small card under an assistant answer. */
  summary?: { value: string; label: string; tone?: 'primary' | 'income' | 'expense' | 'warning' };
};

/** A conversation with the assistant, as the chat history lists it. */
export type ChatThread = {
  id: string;
  /** Claude names it on the first question. */
  title: string;
  createdAt: string;
  /** When its latest message was added. */
  updatedAt: string;
  messageCount: number;
  /** The start of its latest answer. */
  preview: string;
};

export type ChatThreadDetail = ChatThread & { messages: ChatMessage[] };

/** What asking returns: the answer, and its conversation as the history now lists it. */
export type ChatReply = { thread: ChatThread; message: ChatMessage };

// ---- API shapes (computed, not stored) ----

export type DateRange = { from: ISODate; to: ISODate };
export type RangePreset = 'this-month' | 'last-month' | 'last-3-months' | 'last-6-months' | 'year-to-date';

export type TransactionFilters = {
  from?: ISODate;
  to?: ISODate;
  category?: Category;
  cardId?: string;
  kind?: 'income' | 'expense';
  /** Matches merchant, raw description or category, case-insensitive. */
  search?: string;
  limit?: number;
};

export type CategorySpend = { category: Category; amount: number; count: number; share: number };
export type MonthTotals = { month: YearMonth; spent: number; income: number };
export type WeekTotals = { weekStart: ISODate; spent: number };
export type MerchantSpend = { merchant: string; amount: number; count: number };

export type SpendSummary = {
  range: DateRange;
  totalSpent: number;
  totalIncome: number;
  net: number;
  transactionCount: number;
  /** Spending by category. */
  byCategory: CategorySpend[];
  /** Money in by category (share is of totalIncome), largest first. */
  incomeByCategory: CategorySpend[];
  byMonth: MonthTotals[];
  topMerchants: MerchantSpend[];
};

export type RecurringBillStatus = RecurringBill & {
  /** Category of the latest charge, for the icon. */
  category: Category;
  /** Last charge vs usual as a fraction: 2.08 = 208% above usual. */
  changeFromUsual: number;
  /** The last charge was far above usual (25% or more). */
  unusual: boolean;
  /** Days from today to nextDue. */
  daysUntilDue: number;
};

export type BudgetStatus = Budget & {
  month: YearMonth;
  spent: number;
  remaining: number;
  /** spent / monthlyLimit; 0.85 = 85% used. */
  ratio: number;
};

export type SavingsGoalStatus = SavingsGoal & {
  /** Money in minus money out from startDate through asOf; negative when more went out. */
  saved: number;
  /**
   * The latest transaction counted (statements arrive after the fact), or startDate when
   * there is none yet. Progress is measured on this day.
   */
  asOf: ISODate;
  transactionCount: number;
  /** What a steady pace, from nothing at startDate to targetAmount at targetDate, saves by asOf. */
  expected: number;
  /** saved / targetAmount. */
  ratio: number;
  /** saved >= expected. */
  onTrack: boolean;
  /** Saving per month from asOf that still reaches targetAmount; 0 once it is reached. */
  monthlyNeeded: number;
  /** From today to targetDate; negative once it has passed. */
  daysLeft: number;
};

/** Recent complete months of income and spending: what a savings plan starts from. */
export type SpendingBaseline = {
  /** Oldest first; empty when the ledger has no complete month yet. */
  months: YearMonth[];
  /** Average money in per month under income categories. */
  monthlyIncome: number;
  /** Average spending per month by category (purchases minus refunds), largest first. */
  categories: { category: Category; average: number }[];
};

export type PlanCategory = {
  category: Category;
  /** Average monthly spending, in whole dollars. */
  average: number;
  /** Suggested monthly budget, in whole dollars. */
  target: number;
  /** Fixed costs (housing, car, phone, utilities, fees) are never cut. */
  fixed: boolean;
};

/** Monthly budgets that save an amount by a date (planSavings in lib/savings-plan.ts). */
export type SavingsPlan = {
  monthlyIncome: number;
  /** Months from the plan's start to its target date. */
  months: number;
  /** Saving per month that reaches the amount. */
  monthlyNeeded: number;
  /** Largest average first. */
  categories: PlanCategory[];
  /** The suggested targets save monthlyNeeded; false when even the deepest cuts fall short. */
  reachable: boolean;
};

export type OptimizerCategory = {
  category: Category;
  spent: number;
  earned: number;
  potential: number;
  missed: number;
  bestCardId: string;
  spendByCard: { cardId: string; amount: number }[];
};

export type FeeCheck = {
  cardId: string;
  annualFee: number;
  /** What the card actually earned in the period, scaled to 12 months. */
  earnedPerYear: number;
  /** What it would earn if used for every category where it's the best card. */
  potentialPerYear: number;
  /** earnedPerYear >= annualFee */
  covered: boolean;
};

export type CardOptimizer = {
  range: DateRange;
  earned: number;
  potential: number;
  missed: number;
  /** missed scaled to 12 months. */
  missedPerYear: number;
  byCategory: OptimizerCategory[];
  byCard: { cardId: string; spent: number; earned: number }[];
  /** One entry per card with an annual fee. */
  feeChecks: FeeCheck[];
  tips: string[];
};

/**
 * A card's rewards on one statement: the app's own estimate by rate, from the statement's
 * transactions and the card's reward rules, and what the statement itself says it earned.
 */
export type StatementRewards = {
  cardId: string;
  statementId: string;
  statementName: string;
  /** The printed statement period, else the dates of its first and last transactions. */
  range: DateRange;
  /** Purchases minus refunds that earn cashback. */
  spent: number;
  /** The estimate. */
  earned: number;
  /** The estimate by rate, highest first; spend at 0% is left out. */
  byRate: { ratePercent: number; spent: number; earned: number }[];
  /** The statement's own numbers, when it prints a rewards summary. Show these as the amount earned. */
  reported: ReportedRewards | null;
};

export type CategoryUpdate ={ transaction: Transaction; affectedCount: number };

/** What the add and edit card forms save: a card's details plus all of its reward rules. */
export type NewCardInput = Omit<Card, 'id' | 'isPlaceholder'> & {
  rules: Omit<RewardRule, 'cardId'>[];
};

/** Metadata of a file the user picked; the mock never reads its contents. */
export type PickedFile = { name: string; size?: number; mimeType?: string; uri: string };

export type StatementUpload = {
  fileName: string;
  transactionsFound: number;
  range: DateRange;
  totalSpent: number;
  totalIncome: number;
  /** Rows already in the ledger (skipped as duplicates). */
  alreadyInLedger: number;
  newTransactions: number;
  /** not_checked: the backend doesn't reconcile opening and closing balances yet. */
  balanceCheck: 'passed' | 'failed' | 'not_checked';
};

/** A bank statement uploaded to the backend. */
export type Statement = {
  id: string;
  name: string;
  uploadedAt: string;
  pageCount: number;
  /** Pages read so far. */
  pagesDone: number;
  /** processing: being read and categorized; done: in the ledger; incomplete: stopped, see message. */
  status: 'processing' | 'done' | 'incomplete';
  /** What is happening now, or why it stopped short. */
  message: string | null;
  /** Transactions it added to the ledger, once done. */
  transactionCount: number | null;
  /** Last 4 digits of the account number printed on the statement. */
  accountLast4: string | null;
  /**
   * Whether a card's account number matches the statement's (null until categorized). no_match and
   * no_account_number put its transactions on the placeholder card; pending: still being read.
   */
  cardMatch: 'matched' | 'no_match' | 'no_account_number' | 'pending' | null;
  /** The matching card. */
  cardId: string | null;
  /** The statement period as printed; null until read (or if not printed). */
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  /** The rewards summary printed on it; null if it prints none (or it wasn't read yet). */
  rewards: ReportedRewards | null;
};

/** What a statement says it earned in rewards, line by line as printed (e.g. "3% Cash Back 14.17"). */
export type ReportedRewards = {
  /** e.g. "Dividend Cash Back". */
  program: string | null;
  unit: 'dollars' | 'points' | 'miles';
  /** The lines added up. */
  earned: number;
  lines: { label: string; ratePercent: number | null; amount: number }[];
};

/** What was read from a receipt photo. Missing values are null when the receipt doesn't print them. */
export type ReceiptScan = {
  merchant: string;
  date: ISODate | null;
  subtotal: number | null;
  tax: number | null;
  taxLabel: string | null;
  total: number;
  currency: string;
  items: { description: string; amount: number }[];
  /** Suggested category for adding it as an expense. */
  category: Category;
  /** Last 4 digits of the card number printed on the receipt. */
  cardLast4: string | null;
  /** The user's card with that number. */
  cardId: string | null;
  /**
   * The ledger expense this receipt is for: same amount, dated within a few days, on its card
   * (or on the placeholder) when the receipt names one.
   */
  matchedTransaction: Transaction | null;
  /**
   * The saved scan (photo and what was read). It's kept once added as an expense or attached to
   * the matched transaction (attachReceipt); otherwise it's deleted after a day. Null in mock mode.
   */
  receiptId: string | null;
};

/** A saved receipt scan, as shown on its transaction. */
export type Receipt = {
  id: string;
  scannedAt: string;
  merchant: string;
  date: ISODate | null;
  subtotal: number | null;
  tax: number | null;
  taxLabel: string | null;
  total: number;
  currency: string;
  items: { description: string; amount: number }[];
  cardLast4: string | null;
  transactionId: string | null;
  /** The photo as a data: URL. */
  imageDataUrl: string | null;
};

/** An expense added from a scanned receipt. */
export type NewExpenseInput = {
  date: ISODate;
  amount: number;
  currency: string;
  merchant: string;
  category: Category;
  /** A card's id, or CASH_CARD_ID. */
  cardId: string;
  /** The scan it came from, saved with it. */
  receiptId?: string;
};
