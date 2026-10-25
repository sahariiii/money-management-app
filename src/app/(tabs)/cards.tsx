import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AlertBanner,
  Button,
  Card,
  Divider,
  EmptyState,
  Loading,
  PaymentCard,
  Screen,
  SectionHeader,
  StatTile,
} from '@/components';
import { borderWidth, colors, layout, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import { getCardOptimizer, getCards, getRewardRules, getStatementRewards } from '@/lib/api';
import { categoryColor, categoryIcon } from '@/lib/categories';
import { formatShortDate } from '@/lib/dates';
import { formatMoney, maskCard } from '@/lib/format';
import type { Card as CardType, ReportedRewards, RewardRule, StatementRewards } from '@/types';

function ruleLabel(r: RewardRule) {
  const what = r.category === '*' ? 'Everything else' : r.category;
  const cap = r.cap !== null ? ` · up to ${formatMoney(r.cap)}/mo` : '';
  return { rate: `${r.ratePercent}%`, what: `${what}${cap}` };
}

/** An amount in the statement's rewards unit: money for cash back, else e.g. "1,250 points". */
function formatReward(amount: number, unit: ReportedRewards['unit']) {
  return unit === 'dollars' ? formatMoney(amount) : `${amount.toLocaleString()} ${unit}`;
}

/**
 * A card's latest statement: the amount it says it earned, then each rate with the app's own
 * estimate beside the statement's figure. Without a printed summary, the estimate is the amount.
 */
function LastStatement({ rewards }: { rewards: StatementRewards }) {
  const { reported } = rewards;
  const rates = [
    ...new Set([...rewards.byRate.map((r) => r.ratePercent), ...(reported?.lines ?? []).flatMap((l) => l.ratePercent ?? [])]),
  ].sort((a, b) => b - a);
  // Lines that name no rate, e.g. a bonus, are listed by their label.
  const otherLines = reported?.lines.filter((l) => l.ratePercent === null) ?? [];

  return (
    <View style={styles.statement}>
      <Text style={styles.overline}>{rewards.statementName} statement</Text>
      <Text style={styles.statementTotal}>
        {reported ? formatReward(reported.earned, reported.unit) : formatMoney(rewards.earned)}
      </Text>
      <Text style={styles.caption}>
        {formatShortDate(rewards.range.from)} – {formatShortDate(rewards.range.to)} ·{' '}
        {reported ? `as on your statement${reported.program ? ` (${reported.program})` : ''}` : 'estimated from its transactions'}
      </Text>
      {rates.map((rate) => {
        const est = rewards.byRate.find((r) => r.ratePercent === rate);
        const printed = reported?.lines.filter((l) => l.ratePercent === rate);
        return (
          <View key={rate} style={styles.rateRow}>
            <Text style={styles.rateLabel}>{rate}%</Text>
            <Text style={styles.rateEstimate}>
              {est ? `on ${formatMoney(est.spent)} · est. ${formatMoney(est.earned)}` : 'no spending estimated'}
            </Text>
            {reported && (
              <Text style={styles.strong}>
                {printed && printed.length > 0 ? formatReward(sum(printed.map((l) => l.amount)), reported.unit) : '–'}
              </Text>
            )}
          </View>
        );
      })}
      {otherLines.map((l) => (
        <View key={l.label} style={styles.rateRow}>
          <Text style={styles.rateEstimate}>{l.label}</Text>
          <Text style={styles.strong}>{formatReward(l.amount, reported!.unit)}</Text>
        </View>
      ))}
      {reported && (
        <Text style={styles.caption}>
          The app estimated {formatMoney(rewards.earned)} from your categories. Banks set rates by the type of store, so
          the two can differ.
        </Text>
      )}
    </View>
  );
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export default function Cards() {
  const { isWide, contentWidth } = useLayout();
  const cards = useAsync(getCards);
  const rules = useAsync(() => getRewardRules());
  const optimizer = useAsync(() => getCardOptimizer('this-month'));
  const statementRewards = useAsync(getStatementRewards);

  const gap = spacing.lg;
  const half = isWide ? (contentWidth - gap) / 2 : contentWidth;
  const tileWidth = isWide ? (contentWidth - gap * 2) / 3 : (contentWidth - gap) / 2;

  const cardById = new Map((cards.data ?? []).map((c) => [c.id, c]));
  const nameOf = (c?: CardType) => (c ? `${c.nickname} ${maskCard(c.last4)}` : 'Unknown card');
  const opt = optimizer.data;
  const addCard = () => router.push('/add-card');

  return (
    <Screen>
      <SectionHeader
        title="Your cards"
        right={cards.data && cards.data.length > 0 ? <Button label="Add card" icon="add" size="sm" onPress={addCard} /> : undefined}
      />

      {!cards.data || !rules.data ? (
        <Loading />
      ) : cards.data.length === 0 ? (
        <EmptyState
          icon="card-outline"
          title="No cards yet"
          message="Add your cards and their reward rules to see which one to use where."
          actionLabel="Add card"
          onAction={addCard}
        />
      ) : (
        <View style={[styles.grid, { gap }]}>
          {cards.data.map((c) => {
            // Specific categories first, the catch-all rate last.
            const cardRules = rules
              .data!.filter((r) => r.cardId === c.id)
              .sort((a, b) => (a.category === '*' ? 1 : b.category === '*' ? -1 : b.ratePercent - a.ratePercent));
            const earned = opt?.byCard.find((b) => b.cardId === c.id)?.earned;
            const last = statementRewards.data?.find((s) => s.cardId === c.id);
            return (
              <View key={c.id} style={[styles.cardColumn, { width: half }]}>
                <PaymentCard card={c} />
                <Card>
                  <View style={styles.rewardsHeader}>
                    <Text style={styles.overline}>Rewards</Text>
                    {!c.isPlaceholder && (
                      <Button
                        label="Edit"
                        icon="create-outline"
                        variant="ghost"
                        size="sm"
                        onPress={() => router.push(`/edit-card/${c.id}`)}
                      />
                    )}
                  </View>
                  {c.isPlaceholder ? (
                    <Text style={styles.muted}>
                      Transactions from statements whose account number matches none of your cards. Add that
                      account number to the right card and they move to it.
                    </Text>
                  ) : cardRules.length === 0 ? (
                    <Text style={styles.muted}>No rewards on this card.</Text>
                  ) : (
                    cardRules.map((r) => {
                      const l = ruleLabel(r);
                      return (
                        <View key={r.category} style={styles.ruleRow}>
                          <Text style={styles.ruleRate}>{l.rate}</Text>
                          <Text style={styles.ruleWhat}>{l.what}</Text>
                        </View>
                      );
                    })
                  )}
                  {last && <LastStatement rewards={last} />}
                  {earned !== undefined && (
                    <Text style={styles.muted}>
                      This month so far (estimate): <Text style={styles.strong}>{formatMoney(earned)}</Text>
                    </Text>
                  )}
                </Card>
              </View>
            );
          })}
        </View>
      )}

      <SectionHeader
        title="Rewards optimizer"
        subtitle={opt ? `This month so far (${formatShortDate(opt.range.from)} – ${formatShortDate(opt.range.to)})` : undefined}
      />

      {!opt || !cards.data ? (
        <Loading />
      ) : (
        <>
          <View style={[styles.grid, { gap }]}>
            <StatTile
              style={{ width: tileWidth }}
              label="Earned"
              value={formatMoney(opt.earned)}
              caption="Cashback this month"
              icon="gift-outline"
              tone="income"
            />
            <StatTile
              style={{ width: tileWidth }}
              label="Missed"
              value={formatMoney(opt.missed)}
              caption="By using the wrong card"
              icon="trending-down-outline"
              tone="warning"
              tintValue={opt.missed > 0}
            />
            <StatTile
              style={{ width: isWide ? tileWidth : contentWidth }}
              label="Missed per year"
              value={formatMoney(opt.missedPerYear)}
              caption="If you keep spending like this"
              icon="calendar-outline"
              tone="expense"
              tintValue={opt.missedPerYear > 0}
            />
          </View>

          {opt.feeChecks.map((f) => {
            const c = cardById.get(f.cardId);
            if (!c) return null;
            return f.covered ? (
              <AlertBanner
                key={f.cardId}
                tone="success"
                title={`${c.nickname} pays for itself`}
                message={`On pace for about ${formatMoney(f.earnedPerYear)}/yr in cashback, more than its ${formatMoney(f.annualFee)} annual fee.`}
              />
            ) : (
              <AlertBanner
                key={f.cardId}
                tone="danger"
                title={`${c.nickname} isn't covering its ${formatMoney(f.annualFee)} fee`}
                message={
                  `At this pace it earns about ${formatMoney(f.earnedPerYear)}/yr. ` +
                  (f.potentialPerYear >= f.annualFee
                    ? `Using it for the categories below would earn about ${formatMoney(f.potentialPerYear)}/yr and cover the fee.`
                    : `Even used perfectly it would earn about ${formatMoney(f.potentialPerYear)}/yr. Consider a no-fee card.`)
                }
              />
            );
          })}

          <Card>
            <SectionHeader title="Best card per category" />
            {opt.byCategory.length === 0 ? (
              <EmptyState compact icon="card-outline" title="No card spending this month yet" />
            ) : (
              opt.byCategory.map((row, i) => (
                <Fragment key={row.category}>
                  {i > 0 && <Divider />}
                  <View style={styles.bestRow}>
                    <Ionicons name={categoryIcon(row.category)} size={layout.iconSize - spacing.xs} color={categoryColor(row.category)} />
                    <View style={styles.bestText}>
                      <Text style={styles.strong}>{row.category}</Text>
                      <Text style={styles.muted}>
                        {formatMoney(row.spent)} spent · use {nameOf(cardById.get(row.bestCardId))}
                      </Text>
                    </View>
                    {row.missed >= 0.01 ? (
                      <Text style={styles.missed}>−{formatMoney(row.missed)}</Text>
                    ) : (
                      <Ionicons
                        name="checkmark-circle"
                        size={layout.iconSize - spacing.xxs}
                        color={colors.income}
                        accessibilityLabel="Already using the best card"
                      />
                    )}
                  </View>
                </Fragment>
              ))
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  cardColumn: { gap: spacing.md },
  overline: typography.overline,
  rewardsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  ruleRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  ruleRate: { ...typography.heading, color: colors.primary, minWidth: spacing.xxxl },
  ruleWhat: { ...typography.small, flex: 1 },
  muted: typography.muted,
  caption: typography.caption,
  strong: typography.label,
  statement: {
    gap: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: borderWidth.hairline,
    borderTopColor: colors.border,
  },
  statementTotal: { ...typography.stat, color: colors.income },
  rateRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  rateLabel: { ...typography.label, color: colors.primary, minWidth: spacing.xxxl },
  rateEstimate: { ...typography.caption, flex: 1 },
  bestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bestText: { flex: 1, gap: spacing.xxs },
  missed: { ...typography.label, color: colors.warning },
});
