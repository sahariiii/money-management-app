import type { NewCardInput, RewardRule } from '@/types';

/**
 * Known cards and their published cashback, to fill in the card form. Everything but the
 * card's own numbers (last 4, account, statement day), which the user enters.
 */
export type CardPreset = Omit<NewCardInput, 'last4' | 'accountLast4' | 'cycleDay'> & { id: string };

type Rule = Omit<RewardRule, 'cardId'>;

/**
 * CIBC Dividend cards: a top rate on groceries (and on gas and EV charging, `withGas`); 2% on
 * transportation (transit, taxis, rideshare, parking), dining and recurring bills like subscriptions;
 * 1% on everything else. Car is 2% because CIBC counts parking as transportation and monthly car
 * insurance as a recurring payment (it pays 1% on repairs, which the app can't tell apart).
 */
function cibcDividend(topRate: number, withGas: boolean): Rule[] {
  return [
    { category: 'Groceries', ratePercent: topRate, cap: null },
    ...(withGas ? [{ category: 'Gas & EV charging' as const, ratePercent: topRate, cap: null }] : []),
    { category: 'Transport', ratePercent: 2, cap: null },
    { category: 'Car', ratePercent: 2, cap: null },
    { category: 'Food', ratePercent: 2, cap: null },
    { category: 'Subscriptions', ratePercent: 2, cap: null },
    { category: 'Phone & Internet', ratePercent: 2, cap: null },
    { category: 'Utilities', ratePercent: 2, cap: null },
    { category: '*', ratePercent: 1, cap: null },
  ];
}

export const CARD_PRESETS: CardPreset[] = [
  {
    id: 'cibc-dividend-visa-infinite',
    nickname: 'Dividend Visa Infinite',
    institution: 'CIBC',
    type: 'credit',
    annualFee: 120,
    interestRate: 20.99,
    // No gas and EV charging bonus on this one: gas earns the 1% base rate.
    rules: cibcDividend(4, false),
  },
  {
    id: 'cibc-dividend-platinum-visa',
    nickname: 'Dividend Platinum Visa',
    institution: 'CIBC',
    type: 'credit',
    annualFee: 99,
    interestRate: 21.99,
    rules: cibcDividend(3, true),
  },
];
