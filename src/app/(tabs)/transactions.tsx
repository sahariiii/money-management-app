import { router } from 'expo-router';
import { Fragment, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Chip, Divider, EmptyState, Loading, Screen, TransactionRow } from '@/components';
import { colors, fontWeight, layout, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import { getCards, getTransactions, resolveRange, today } from '@/lib/api';
import { addDays, formatShortDate } from '@/lib/dates';
import { formatMoney, maskCard } from '@/lib/format';
import { CATEGORIES, type Category, type RangePreset, type Transaction } from '@/types';

const RANGES: { key: RangePreset; label: string }[] = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-3-months', label: 'Last 3 months' },
];

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

function dayLabel(date: string) {
  const now = today();
  if (date === now) return `Today · ${formatShortDate(date)}`;
  if (date === addDays(now, -1)) return `Yesterday · ${formatShortDate(date)}`;
  return formatShortDate(date);
}

export default function Transactions() {
  const { isWide } = useLayout();
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
        <FilterRow label="Dates" wrap={isWide}>
          {RANGES.map((r) => (
            <Chip key={r.key} label={r.label} selected={rangeKey === r.key} onPress={() => setRangeKey(r.key)} />
          ))}
        </FilterRow>
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
  filters: { gap: spacing.md },
  filterRow: { gap: spacing.xs },
  filterLabel: typography.overline,
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingRight: 0 },
  summary: typography.muted,
  expense: { color: colors.expense, fontWeight: fontWeight.semibold },
  income: { color: colors.income, fontWeight: fontWeight.semibold },
  group: { gap: spacing.sm },
  groupHeader: { ...typography.label, color: colors.muted },
  groupCard: { paddingVertical: spacing.xs, gap: 0 },
});
