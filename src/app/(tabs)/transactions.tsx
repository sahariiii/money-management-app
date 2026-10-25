import { router } from 'expo-router';
import { Fragment, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AlertBanner, Card, Chip, Divider, EmptyState, Loading, Screen, TextField, TransactionRow } from '@/components';
import { colors, fontWeight, layout, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import { getCards, getStatements, getTransactions, resolveRange, today } from '@/lib/api';
import { addDays, formatShortDate, isISODate } from '@/lib/dates';
import { formatMoney, maskCard } from '@/lib/format';
import {
  CASH_CARD_ID,
  CATEGORIES,
  type Category,
  type DateRange,
  type RangePreset,
  type Statement,
  type Transaction,
} from '@/types';

const RANGES: { key: RangePreset; label: string }[] = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-3-months', label: 'Last 3 months' },
  { key: 'last-6-months', label: 'Last 6 months' },
];

/** Errors only once a date is fully typed, so half-typed ones aren't flagged. */
function dateError(value: string) {
  return value.length >= 10 && !isISODate(value) ? 'Use YYYY-MM-DD.' : undefined;
}

/**
 * From/To fields for a custom range. Calls onChange whenever both dates are
 * valid and in order; until then the list keeps the last valid range.
 */
function CustomRange({ initial, onChange }: { initial: DateRange; onChange: (range: DateRange) => void }) {
  const [from, setFrom] = useState<string>(initial.from);
  const [to, setTo] = useState<string>(initial.to);

  function update(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (isISODate(nextFrom) && isISODate(nextTo) && nextFrom <= nextTo) onChange({ from: nextFrom, to: nextTo });
  }

  const outOfOrder = isISODate(from) && isISODate(to) && to < from;
  const field = { placeholder: 'YYYY-MM-DD', maxLength: 10, keyboardType: 'numbers-and-punctuation' as const, style: styles.flex };
  return (
    <View style={styles.customRange}>
      <TextField {...field} label="From" value={from} onChangeText={(v) => update(v.trim(), to)} error={dateError(from)} />
      <TextField
        {...field}
        label="To"
        value={to}
        onChangeText={(v) => update(from, v.trim())}
        error={dateError(to) ?? (outOfOrder ? 'Must be on or after From.' : undefined)}
      />
    </View>
  );
}

/**
 * A labelled row of chips. Phones swipe it sideways; wide screens wrap it onto
 * more lines, because a sideways-scrolling row is awkward with a mouse.
 */
function FilterRow({ label, wrap, children }: { label: string; wrap: boolean; children: ReactNode }) {
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      {wrap ? (
        <View style={[styles.chips, styles.chipsWrap]}>{children}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {children}
        </ScrollView>
      )}
    </View>
  );
}

function groupByDate(txs: Transaction[]) {
  const groups: { date: string; items: Transaction[] }[] = [];
  for (const t of txs) {
    const last = groups[groups.length - 1];
    if (last?.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }
  return groups;
}

/** Which statements matched no card, and how to fix it. */
function unmatchedMessage(list: Statement[]) {
  const which = list
    .map((s) => `${s.name.replace(/\.pdf$/i, '')}: ${s.accountLast4 ? `account ${maskCard(s.accountLast4)}` : 'no account number found on it'}`)
    .join(' · ');
  const theirs = list.length === 1 ? 'its' : 'their';
  return `${which}. Until then ${theirs} transactions are under "Unmatched statements". Add the account number to the right card (Cards → Edit) to link them.`;
}

function dayLabel(date: string) {
  const now = today();
  if (date === now) return `Today · ${formatShortDate(date)}`;
  if (date === addDays(now, -1)) return `Yesterday · ${formatShortDate(date)}`;
  return formatShortDate(date);
}

export default function Transactions() {
  const { isWide } = useLayout();
  const [rangeKey, setRangeKey] = useState<RangePreset | 'custom'>('this-month');
  const [customRange, setCustomRange] = useState<DateRange>();
  const [cardId, setCardId] = useState<string>();
  const [category, setCategory] = useState<Category>();

  const range = rangeKey === 'custom' && customRange ? customRange : resolveRange(rangeKey === 'custom' ? 'this-month' : rangeKey);

  function pickCustom() {
    // Start from whatever range is showing, so the fields are already filled in.
    setCustomRange(range);
    setRangeKey('custom');
  }
  const filters = { from: range.from, to: range.to, cardId, category };
  const txs = useAsync(() => getTransactions(filters), JSON.stringify(filters));
  const cards = useAsync(getCards);
  const statements = useAsync(getStatements);
  const unmatched = (statements.data ?? []).filter((s) => s.cardMatch === 'no_match' || s.cardMatch === 'no_account_number');

  const cardById = new Map((cards.data ?? []).map((c) => [c.id, c]));
  const list = txs.data ?? [];
  const spent = list.filter((t) => !t.isIncome).reduce((s, t) => s + t.amount, 0);
  const income = list.filter((t) => t.isIncome).reduce((s, t) => s + t.amount, 0);
  const hasFilters = !!cardId || !!category;

  return (
    <Screen>
      {unmatched.length > 0 && (
        <AlertBanner
          tone="warning"
          title={
            unmatched.length === 1
              ? "1 statement doesn't match any of your cards"
              : `${unmatched.length} statements don't match any of your cards`
          }
          message={unmatchedMessage(unmatched)}
          actions={[{ label: 'Go to cards', onPress: () => router.push('/cards') }]}
        />
      )}

      <View style={styles.filters}>
        <FilterRow label="Dates" wrap={isWide}>
          {RANGES.map((r) => (
            <Chip key={r.key} label={r.label} selected={rangeKey === r.key} onPress={() => setRangeKey(r.key)} />
          ))}
          <Chip label="Custom" selected={rangeKey === 'custom'} onPress={() => rangeKey !== 'custom' && pickCustom()} />
        </FilterRow>
        {rangeKey === 'custom' && customRange && <CustomRange initial={customRange} onChange={setCustomRange} />}
        <FilterRow label="Card" wrap={isWide}>
          <Chip label="All cards" selected={!cardId} onPress={() => setCardId(undefined)} />
          {(cards.data ?? []).map((c) => (
            <Chip
              key={c.id}
              label={`${c.nickname} ${maskCard(c.last4)}`}
              selected={cardId === c.id}
              onPress={() => setCardId(c.id)}
            />
          ))}
        </FilterRow>
        <FilterRow label="Category" wrap={isWide}>
          <Chip label="All" selected={!category} onPress={() => setCategory(undefined)} />
          {CATEGORIES.map((c) => (
            <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </FilterRow>
      </View>

      {!txs.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title="No transactions"
          message={hasFilters ? 'Nothing matches these filters.' : 'Nothing in this period yet.'}
          actionLabel={hasFilters ? 'Clear filters' : undefined}
          onAction={() => {
            setCardId(undefined);
            setCategory(undefined);
          }}
        />
      ) : (
        <>
          <Text style={styles.summary}>
            {list.length} transactions · <Text style={styles.expense}>−{formatMoney(spent)}</Text>
            {income > 0 && (
              <>
                {' · '}
                <Text style={styles.income}>+{formatMoney(income)}</Text>
              </>
            )}
          </Text>

          {groupByDate(list).map((g) => (
            <View key={g.date} style={styles.group}>
              <Text style={styles.groupHeader}>{dayLabel(g.date)}</Text>
              <Card style={styles.groupCard}>
                {g.items.map((t, i) => {
                  const card = cardById.get(t.cardId);
                  return (
                    <Fragment key={t.id}>
                      {i > 0 && <Divider inset={layout.avatarSize + spacing.md} />}
                      <TransactionRow
                        merchant={t.merchant}
                        category={t.category}
                        subtitle={
                          card
                            ? `${t.category} · ${maskCard(card.last4)}`
                            : t.cardId === CASH_CARD_ID
                              ? `${t.category} · Cash`
                              : t.category
                        }
                        amount={t.amount}
                        isIncome={t.isIncome}
                        currency={t.currency}
                        onPress={() => router.push(`/transaction/${t.id}`)}
                      />
                    </Fragment>
                  );
                })}
              </Card>
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: spacing.md },
  filterRow: { gap: spacing.xs },
  filterLabel: typography.overline,
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingRight: 0 },
  customRange: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  summary: typography.muted,
  expense: { color: colors.expense, fontWeight: fontWeight.semibold },
  income: { color: colors.income, fontWeight: fontWeight.semibold },
  group: { gap: spacing.sm },
  groupHeader: { ...typography.label, color: colors.muted },
  groupCard: { paddingVertical: spacing.xs, gap: 0 },
});
