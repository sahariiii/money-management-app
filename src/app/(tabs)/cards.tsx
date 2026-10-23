import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AlertBanner,
  Button,
  Card,
  Loading,
  PaymentCard,
  Screen,
  SectionHeader,
  StatTile,
} from '@/components';
import { colors, fontSize, fontWeight, layout, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import { getCardOptimizer, getCards, getRewardRules } from '@/lib/api';
import { categoryColor, categoryIcon } from '@/lib/categories';
import { formatShortDate } from '@/lib/dates';
import { formatMoney, formatMoneyWhole, maskCard } from '@/lib/format';
import type { Card as CardType, RewardRule } from '@/types';

function ruleLabel(r: RewardRule) {
  const what = r.category === '*' ? 'Everything else' : r.category;
  const cap = r.cap !== null ? ` · up to ${formatMoneyWhole(r.cap)}/mo` : '';
  return { rate: `${r.ratePercent}%`, what: `${what}${cap}` };
}

export default function Cards() {
  const { isWide, contentWidth } = useLayout();
  const cards = useAsync(getCards);
  const rules = useAsync(() => getRewardRules());
  const optimizer = useAsync(() => getCardOptimizer('this-month'));

  const gap = spacing.lg;
  const cardCols = isWide ? 2 : 1;
  const cardWidth = (contentWidth - gap * (cardCols - 1)) / cardCols;
  const tileWidth = isWide ? (contentWidth - spacing.md * 2) / 3 : (contentWidth - spacing.md) / 2;

  const cardById = new Map((cards.data ?? []).map((c) => [c.id, c]));
  const nameOf = (c?: CardType) => (c ? `${c.nickname} ${maskCard(c.last4)}` : 'Unknown card');
  const opt = optimizer.data;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <SectionHeader title="Your cards" />
        <Button label="Add card" icon="add" size="sm" onPress={() => router.push('/add-card')} />
      </View>

      {!cards.data || !rules.data ? (
        <Loading />
      ) : (
        <View style={[styles.grid, { gap }]}>
          {cards.data.map((c) => {
            const cardRules = rules.data!.filter((r) => r.cardId === c.id);
            // Specific categories first, the catch-all rate last.
            cardRules.sort((a, b) => (a.category === '*' ? 1 : b.category === '*' ? -1 : b.ratePercent - a.ratePercent));
            const earned = opt?.byCard.find((b) => b.cardId === c.id)?.earned;
            return (
              <View key={c.id} style={[styles.cardColumn, { width: cardWidth }]}>
                <PaymentCard card={c} />
                <Card>
                  <Text style={styles.cardSectionLabel}>Rewards</Text>
                  {cardRules.length === 0 ? (
                    <Text style={styles.muted}>No rewards on this card.</Text>
                  ) : (
                    cardRules.map((r) => {
                      const l = ruleLabel(r);
                      return (
                        <View key={`${r.category}`} style={styles.ruleRow}>
                          <Text style={styles.ruleRate}>{l.rate}</Text>
                          <Text style={styles.ruleWhat}>{l.what}</Text>
                        </View>
                      );
                    })
                  )}
                  {earned !== undefined && (
                    <Text style={styles.muted}>
                      Earned this month: <Text style={styles.strong}>{formatMoney(earned)}</Text>
                    </Text>
                  )}
                </Card>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.sectionTitle}>
        <SectionHeader title="Rewards optimizer" />
        {opt && (
          <Text style={styles.muted}>
            This month so far ({formatShortDate(opt.range.from)} – {formatShortDate(opt.range.to)})
          </Text>
        )}
      </View>

      {!opt || !cards.data ? (
        <Loading />
      ) : (
        <>
          <View style={[styles.grid, { gap: spacing.md }]}>
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
                message={`On pace for about ${formatMoneyWhole(f.earnedPerYear)}/yr in cashback, more than its ${formatMoneyWhole(f.annualFee)} annual fee.`}
              />
            ) : (
              <AlertBanner
                key={f.cardId}
                tone="danger"
                title={`${c.nickname} isn't covering its ${formatMoneyWhole(f.annualFee)} fee`}
                message={
                  `At this pace it earns about ${formatMoneyWhole(f.earnedPerYear)}/yr. ` +
                  (f.potentialPerYear >= f.annualFee
                    ? `Using it for the categories below would earn about ${formatMoneyWhole(f.potentialPerYear)}/yr and cover the fee.`
                    : `Even used perfectly it would earn about ${formatMoneyWhole(f.potentialPerYear)}/yr. Consider a no-fee card.`)
                }
              />
            );
          })}

          <Card>
            <SectionHeader title="Best card per category" />
            {opt.byCategory.length === 0 && <Text style={styles.muted}>No card spending this month yet.</Text>}
            {opt.byCategory.map((row, i) => (
              <Fragment key={row.category}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.bestRow}>
                  <Ionicons name={categoryIcon(row.category)} size={layout.iconSize - 4} color={categoryColor(row.category)} />
                  <View style={styles.bestText}>
                    <Text style={styles.strong}>{row.category}</Text>
                    <Text style={styles.muted}>
                      {formatMoney(row.spent)} spent · use {nameOf(cardById.get(row.bestCardId))}
                    </Text>
                  </View>
                  {row.missed >= 0.01 ? (
                    <Text style={styles.missed}>−{formatMoney(row.missed)}</Text>
                  ) : (
                    <Ionicons name="checkmark-circle" size={layout.iconSize - 2} color={colors.income} accessibilityLabel="Already using the best card" />
                  )}
                </View>
              </Fragment>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cardColumn: { gap: spacing.md },
  cardSectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  ruleRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  ruleRate: { minWidth: spacing.xxxl, fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.primary },
  ruleWhat: { flex: 1, fontSize: fontSize.sm, color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.muted },
  strong: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  sectionTitle: { gap: spacing.xxs, marginTop: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  bestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bestText: { flex: 1, gap: spacing.xxs },
  missed: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.warning },
});
