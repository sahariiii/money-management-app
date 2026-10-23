import { router } from 'expo-router';
import { Fragment, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Chip, EmptyState, Loading, Screen, TransactionRow } from '@/components';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { getCards, getTransactions, resolveRange, today } from '@/lib/api';
import { formatLongDate } from '@/lib/dates';
import { formatMoney, maskCard } from '@/lib/format';
import { CATEGORIES, type Category, type RangePreset, type Transaction } from '@/types';

const RANGES: { key: RangePreset; label: string }[] = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-3-months', label: 'Last 3 months' },
];

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {children}
      </ScrollView>
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

function dayLabel(date: string) {
  const now = today();
  const yesterday = new Date(Date.parse(`${now}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (date === now) return 'Today';
  if (date === yesterday) return `Yesterday · ${formatLongDate(date)}`;
  return formatLongDate(date);
}

export default function Transactions() {
  const [rangeKey, setRangeKey] = useState<RangePreset>('this-month');
  const [cardId, setCardId] = useState<string>();
  const [category, setCategory] = useState<Category>();

  const range = resolveRange(rangeKey);
  const filters = { from: range.from, to: range.to, cardId, category };
  const txs = useAsync(() => getTransactions(filters), JSON.stringify(filters));
  const cards = useAsync(getCards);

  const cardById = new Map((cards.data ?? []).map((c) => [c.id, c]));
  const list = txs.data ?? [];
  const spent = list.filter((t) => !t.isIncome).reduce((s, t) => s + t.amount, 0);
  const income = list.filter((t) => t.isIncome).reduce((s, t) => s + t.amount, 0);
  const hasFilters = !!cardId || !!category;

  return (
    <Screen>
      <View style={styles.filters}>
        <FilterRow label="Dates">
          {RANGES.map((r) => (
            <Chip key={r.key} label={r.label} selected={rangeKey === r.key} onPress={() => setRangeKey(r.key)} />
          ))}
        </FilterRow>
        <FilterRow label="Card">
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
        <FilterRow label="Category">
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
          message="Nothing matches these filters."
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
                      {i > 0 && <View style={styles.divider} />}
                      <TransactionRow
                        merchant={t.merchant}
                        category={t.category}
                        subtitle={card ? `${t.category} · ${maskCard(card.last4)}` : t.category}
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
  filters: { gap: spacing.sm },
  filterRow: { gap: spacing.xs },
  filterLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  summary: { fontSize: fontSize.sm, color: colors.muted },
  expense: { color: colors.expense, fontWeight: fontWeight.semibold },
  income: { color: colors.income, fontWeight: fontWeight.semibold },
  group: { gap: spacing.sm },
  groupHeader: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.muted },
  groupCard: { paddingVertical: spacing.xs, gap: 0 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.xxxl + spacing.xs },
});
