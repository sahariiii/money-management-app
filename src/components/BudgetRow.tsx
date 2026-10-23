import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontWeight, layout, spacing, typography } from '@/constants/theme';
import { categoryColor, categoryIcon } from '@/lib/categories';
import { formatMoney } from '@/lib/format';
import type { BudgetStatus } from '@/types';
import { ProgressBar } from './ProgressBar';

type Props = {
  budget: BudgetStatus;
  /** Shows a pencil button that calls this. */
  onEdit?: () => void;
};

/** Category budget: spent vs limit, a progress bar (amber at 80%, red at 100%) and what's left. */
export function BudgetRow({ budget: b, onEdit }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Ionicons name={categoryIcon(b.category)} size={layout.iconSize - spacing.xs} color={categoryColor(b.category)} />
        <Text style={styles.name} numberOfLines={1}>
          {b.category}
        </Text>
        <Text style={styles.amount}>
          {formatMoney(b.spent)} <Text style={styles.limit}>of {formatMoney(b.monthlyLimit)}</Text>
        </Text>
        {onEdit && (
          <Pressable
            onPress={onEdit}
            hitSlop={spacing.sm}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${b.category} budget`}
            style={({ pressed }) => pressed && styles.pressed}>
            <Ionicons name="pencil" size={layout.iconSize - spacing.sm} color={colors.primary} />
          </Pressable>
        )}
      </View>
      <ProgressBar value={b.ratio} />
      <Text style={styles.caption}>
        {Math.round(b.ratio * 100)}% used ·{' '}
        {b.remaining >= 0 ? `${formatMoney(b.remaining)} left` : `${formatMoney(-b.remaining)} over`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs + spacing.xxs },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.label, flex: 1 },
  amount: typography.label,
  // Nested in `amount`, so it only changes color and weight.
  limit: { color: colors.muted, fontWeight: fontWeight.regular },
  caption: typography.caption,
  pressed: { opacity: 0.5 },
});
