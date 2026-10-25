import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fontWeight, spacing, typography } from '@/constants/theme';
import { formatDateWithYear, formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import type { SavingsGoalStatus } from '@/types';
import { Button } from './Button';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { ProgressBar } from './ProgressBar';
import { SectionHeader } from './SectionHeader';

type Props = {
  /** null: no goal yet, shows a prompt to set one. */
  goal: SavingsGoalStatus | null;
  /** Opens the savings goal screen. */
  onEdit: () => void;
  style?: StyleProp<ViewStyle>;
};

function statusLine(g: SavingsGoalStatus): string {
  if (g.saved >= g.targetAmount) return `You've saved the whole ${formatMoney(g.targetAmount)}.`;
  if (g.daysLeft < 0) return `The target date has passed, ${formatMoney(g.targetAmount - g.saved)} short.`;
  if (g.transactionCount === 0) {
    return `Saving counts from ${formatShortDate(g.startDate)}. Upload statements as they arrive to see your progress.`;
  }
  if (g.onTrack) return `On track: a steady pace would have saved ${formatMoney(g.expected)} by ${formatShortDate(g.asOf)}.`;
  return (
    `${formatMoney(g.expected - g.saved)} behind a steady pace by ${formatShortDate(g.asOf)}. ` +
    `Save ${formatMoney(g.monthlyNeeded)} a month from here to catch up.`
  );
}

/** The savings goal: saved so far (money in minus money out since it was set) against the target. */
export function GoalCard({ goal: g, onEdit, style }: Props) {
  if (!g) {
    return (
      <Card style={style}>
        <SectionHeader title="Savings goal" />
        <EmptyState
          compact
          icon="flag-outline"
          title="No savings goal yet"
          message="Pick an amount and a date. The app suggests a monthly budget for each category that gets you there."
          actionLabel="Set a goal"
          onAction={onEdit}
        />
      </Card>
    );
  }

  const behind = !g.onTrack && g.transactionCount > 0;
  return (
    <Card style={style}>
      <SectionHeader
        title={g.name}
        subtitle={`${formatMoney(g.targetAmount)} by ${formatDateWithYear(g.targetDate)}`}
        right={<Button label="Edit plan" variant="ghost" size="sm" icon="create-outline" onPress={onEdit} />}
      />
      <View style={styles.amounts}>
        <Text style={[styles.saved, g.saved < 0 && styles.negative]}>
          {g.saved < 0 ? '−' : ''}
          {formatMoney(Math.abs(g.saved))}
        </Text>
        <Text style={styles.of}>saved of {formatMoney(g.targetAmount)}</Text>
      </View>
      <ProgressBar value={Math.max(0, g.ratio)} color={behind ? colors.warning : colors.income} />
      <Text style={[styles.status, behind && styles.behind]}>{statusLine(g)}</Text>
      <Text style={styles.caption}>
        {g.transactionCount > 0 ? `Counted through ${formatShortDate(g.asOf)}, your latest transaction · ` : ''}
        {g.daysLeft >= 0 ? `${g.daysLeft} days left` : 'Ended'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  amounts: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm },
  saved: { ...typography.stat, color: colors.income },
  negative: { color: colors.expense },
  of: typography.muted,
  status: typography.small,
  behind: { color: colors.warning, fontWeight: fontWeight.medium },
  caption: typography.caption,
});
