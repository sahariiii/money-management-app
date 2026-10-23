import { router } from 'expo-router';
import { Fragment, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AlertItem,
  BudgetRow,
  Button,
  Card,
  CategoryDonut,
  Divider,
  EmptyState,
  Loading,
  MonthSelector,
  Screen,
  SectionHeader,
  StatTile,
  WeeklySpendChart,
} from '@/components';
import { colors, lineHeight, spacing, typography } from '@/constants/theme';
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

  const gap = spacing.lg;
  const tileCols = isWide ? 3 : 2;
  const tileWidth = (contentWidth - gap * (tileCols - 1)) / tileCols;
  const half = isWide ? (contentWidth - gap) / 2 : contentWidth;
  const chartWidth = half - spacing.lg * 2;

  const onDismiss = async (id: string) => {
    alerts.setData((alerts.data ?? []).filter((a) => a.id !== id));
    await dismissAlert(id);
  };

  const s = summary.data;
  const topBudgets = [...(budgets.data ?? [])].sort((a, b) => b.spent - a.spent).slice(0, 4);
  const tip = optimizer.data?.byCategory.find((c) => c.missed >= 1);
  const tipCard = cards.data?.find((c) => c.id === tip?.bestCardId);
  const tipShareElsewhere = tip
    ? Math.round(((tip.spent - (tip.spendByCard.find((c) => c.cardId === tip.bestCardId)?.amount ?? 0)) / tip.spent) * 100)
    : 0;
  const periodLabel = isCurrent ? 'this month' : `in ${formatMonth(month, 'short')}`;
  const noWeeklySpend = weekly.data?.every((w) => w.spent === 0);

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
        <AlertItem key={a.id} alert={a} onDismiss={onDismiss} />
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
        <Card style={{ width: half }}>
          <SectionHeader title="Spending by category" subtitle={formatMonth(month)} />
          {!s ? (
            <Loading />
          ) : s.byCategory.length === 0 ? (
            <EmptyState compact icon="pie-chart-outline" title="No spending yet" message="Upload a statement to see where your money goes." />
          ) : (
            <CategoryDonut data={s.byCategory} horizontal={!isWide && chartWidth > 420} />
          )}
        </Card>
        <Card style={{ width: half }}>
          <SectionHeader title="Weekly spending" subtitle="Last 3 months, excluding rent" />
          {!weekly.data ? (
            <Loading />
          ) : noWeeklySpend ? (
            <EmptyState compact icon="analytics-outline" title="No spending yet" />
          ) : (
            <WeeklySpendChart data={weekly.data} width={chartWidth} />
          )}
        </Card>
      </View>

      <View style={[styles.grid, { gap }]}>
        <Card style={{ width: half }}>
          <SectionHeader title="Budgets" actionLabel="See all" onAction={() => router.push('/more')} />
          {!budgets.data ? (
            <Loading />
          ) : topBudgets.length === 0 ? (
            <EmptyState
              compact
              icon="pie-chart-outline"
              title="No budgets yet"
              actionLabel="Set up budgets"
              onAction={() => router.push('/more')}
            />
          ) : (
            topBudgets.map((b, i) => (
              <Fragment key={b.category}>
                {i > 0 && <Divider />}
                <BudgetRow budget={b} />
              </Fragment>
            ))
          )}
        </Card>

        <Card style={[{ width: half }, styles.tipCard]}>
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
                {tipShareElsewhere}% of your {tip.category.toLowerCase()} spending {periodLabel} went on a card that earns
                less.
              </Text>
              <Button
                label="See all card tips"
                variant="secondary"
                size="sm"
                icon="card-outline"
                style={styles.start}
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
  headerText: { gap: spacing.xxs, flexShrink: 1 },
  greeting: typography.title,
  subtitle: typography.muted,
  // Default stretch: cards side by side get equal heights.
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  caption: typography.caption,
  tipCard: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  tipHeadline: { ...typography.subheading, lineHeight: lineHeight.md },
  start: { alignSelf: 'flex-start' },
});
