import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AlertBanner,
  Button,
  Card,
  CategoryDonut,
  EmptyState,
  Loading,
  MonthSelector,
  ProgressBar,
  Screen,
  SectionHeader,
  StatTile,
  WeeklySpendChart,
} from '@/components';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import {
  currentMonth,
  dismissAlert,
  getAlerts,
  getBudgets,
  getCardOptimizer,
  getCards,
  getMonths,
  getSpendSummary,
  getWeeklySpend,
  today,
} from '@/lib/api';
import { formatMonth, formatShortDate, monthRange } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import type { Alert } from '@/types';

const ALERT_UI: Record<Alert['type'], { title: string; tone: 'warning' | 'danger' | 'info' }> = {
  bill_change: { title: 'Bill went up', tone: 'danger' },
  budget: { title: 'Budget check', tone: 'warning' },
  duplicate: { title: 'Possible duplicate', tone: 'info' },
  unusual: { title: 'Unusual charge', tone: 'warning' },
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const { isWide, contentWidth } = useLayout();
  const [month, setMonth] = useState(currentMonth());
  const range = monthRange(month, today());
  const isCurrent = month === currentMonth();

  const months = useAsync(getMonths);
  const summary = useAsync(() => getSpendSummary(range), month);
  const budgets = useAsync(() => getBudgets(month), month);
  const optimizer = useAsync(() => getCardOptimizer(range), month);
  const cards = useAsync(getCards);
  const alerts = useAsync(() => getAlerts('open'));
  const weekly = useAsync(() => getWeeklySpend('last-3-months'));

  const gap = spacing.md;
  const tileCols = isWide ? 3 : 2;
  const tileWidth = (contentWidth - gap * (tileCols - 1)) / tileCols;
  const chartCardWidth = isWide ? (contentWidth - gap) / 2 : contentWidth;
  const chartWidth = chartCardWidth - spacing.lg * 2;

  const onDismiss = async (id: string) => {
    alerts.setData((alerts.data ?? []).filter((a) => a.id !== id));
    await dismissAlert(id);
  };

  const onCheck = (alert: Alert) => {
    if (alert.transactionId) router.push(`/transaction/${alert.transactionId}`);
    else router.push('/transactions');
  };

  const s = summary.data;
  const topBudgets = [...(budgets.data ?? [])].sort((a, b) => b.spent - a.spent).slice(0, 4);
  const tip = optimizer.data?.byCategory.find((c) => c.missed >= 1);
  const tipCard = cards.data?.find((c) => c.id === tip?.bestCardId);
  const periodLabel = isCurrent ? 'this month' : `in ${formatMonth(month, 'short')}`;

  return (
    <Screen>
      <View style={[styles.header, isWide && styles.headerWide]}>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>{greeting()}</Text>
          <Text style={styles.subtitle}>
            {isCurrent ? `Here's your month so far (to ${formatShortDate(range.to)})` : "Here's how the month went"}
          </Text>
        </View>
        {months.data && <MonthSelector months={months.data} value={month} onChange={setMonth} />}
      </View>

      {(alerts.data ?? []).map((a) => (
        <AlertBanner
          key={a.id}
          tone={ALERT_UI[a.type].tone}
          title={ALERT_UI[a.type].title}
          message={a.message}
          actions={[
            { label: 'Check', onPress: () => onCheck(a) },
            { label: 'This is fine', onPress: () => onDismiss(a.id) },
          ]}
        />
      ))}

      {!s ? (
        <Loading />
      ) : (
        <View style={[styles.grid, { gap }]}>
          <StatTile
            style={{ width: tileWidth }}
            label="Spent"
            value={formatMoney(s.totalSpent)}
            caption={`${s.transactionCount} transactions`}
            icon="arrow-up-circle-outline"
            tone="expense"
          />
          <StatTile
            style={{ width: tileWidth }}
            label="Income"
            value={formatMoney(s.totalIncome)}
            caption="Paycheques and deposits"
            icon="arrow-down-circle-outline"
            tone="income"
          />
          <StatTile
            style={{ width: isWide ? tileWidth : contentWidth }}
            label="Net cash flow"
            value={`${s.net >= 0 ? '+' : '−'}${formatMoney(Math.abs(s.net))}`}
            caption={s.net >= 0 ? 'You kept more than you spent' : 'You spent more than you earned'}
            icon="swap-vertical-outline"
            tone={s.net >= 0 ? 'income' : 'expense'}
            tintValue
          />
        </View>
      )}

      <View style={[styles.grid, { gap }]}>
        <Card style={{ width: chartCardWidth }}>
          <SectionHeader title="Spending by category" />
          {s ? (
            s.byCategory.length ? (
              <CategoryDonut data={s.byCategory} horizontal={!isWide && chartWidth > 420} />
            ) : (
              <EmptyState title="No spending yet" icon="pie-chart-outline" />
            )
          ) : (
            <Loading />
          )}
        </Card>
        <Card style={{ width: chartCardWidth }}>
          <SectionHeader title="Weekly spending" />
          <Text style={styles.caption}>Last 3 months, excluding rent</Text>
          {weekly.data ? <WeeklySpendChart data={weekly.data} width={chartWidth} /> : <Loading />}
        </Card>
      </View>

      <View style={[styles.grid, { gap }]}>
        <Card style={{ width: chartCardWidth }}>
          <SectionHeader title="Budgets" />
          {budgets.data ? (
            topBudgets.map((b) => (
              <View key={b.category} style={styles.budget}>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetName}>{b.category}</Text>
                  <Text style={styles.budgetAmount}>
                    {formatMoney(b.spent)} <Text style={styles.muted}>of {formatMoney(b.monthlyLimit)}</Text>
                  </Text>
                </View>
                <ProgressBar value={b.ratio} />
                <Text style={styles.caption}>
                  {Math.round(b.ratio * 100)}% used ·{' '}
                  {b.remaining >= 0 ? `${formatMoney(b.remaining)} left` : `${formatMoney(-b.remaining)} over`}
                </Text>
              </View>
            ))
          ) : (
            <Loading />
          )}
        </Card>

        <Card style={[{ width: chartCardWidth }, styles.tipCard]}>
          <SectionHeader title="Card optimizer" />
          {!optimizer.data || !cards.data ? (
            <Loading />
          ) : tip && tipCard ? (
            <>
              <Text style={styles.tipHeadline}>
                Put {tip.category.toLowerCase()} on your {tipCard.nickname}: about {formatMoney(tip.missed)} more{' '}
                {periodLabel}.
              </Text>
              <Text style={styles.caption}>
                {Math.round(
                  ((tip.spent - (tip.spendByCard.find((c) => c.cardId === tipCard.id)?.amount ?? 0)) / tip.spent) * 100,
                )}
                % of your {tip.category.toLowerCase()} spending {periodLabel} went on a card that earns less.
              </Text>
              <Button
                label="See all card tips"
                variant="secondary"
                size="sm"
                icon="card-outline"
                style={styles.tipButton}
                onPress={() => router.push('/cards')}
              />
            </>
          ) : (
            <Text style={styles.tipHeadline}>You used your best card for everything {periodLabel}. Nice.</Text>
          )}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md },
  headerWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerText: { gap: spacing.xxs },
  greeting: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  caption: { fontSize: fontSize.xs, color: colors.muted },
  muted: { color: colors.muted, fontWeight: fontWeight.regular },
  budget: { gap: spacing.xs + spacing.xxs },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  budgetName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  budgetAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  tipCard: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  tipHeadline: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text, lineHeight: fontSize.md * 1.4 },
  tipButton: { alignSelf: 'flex-start' },
});
