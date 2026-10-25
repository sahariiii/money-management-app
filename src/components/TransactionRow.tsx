import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/constants/theme';
import { formatMoney } from '@/lib/format';
import type { Category } from '@/types';
import { CategoryBadge } from './CategoryBadge';

type Props = {
  merchant: string;
  category: Category;
  /** Secondary line, e.g. "Food · •••• 7392". */
  subtitle: string;
  /** Always positive; direction comes from isIncome. */
  amount: number;
  isIncome: boolean;
  /**
   * refund: money back for a purchase, shown neutral rather than as income. returned: a purchase
   * that all came back, shown struck through since it no longer counts as spending.
   */
  variant?: 'refund' | 'returned';
  currency?: string;
  onPress?: () => void;
};

export function TransactionRow({ merchant, category, subtitle, amount, isIncome, variant, currency, onPress }: Props) {
  const color = variant ? colors.muted : isIncome ? colors.income : colors.expense;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <CategoryBadge category={category} />
      <View style={styles.middle}>
        <Text style={styles.merchant} numberOfLines={1}>
          {merchant}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text style={[styles.amount, { color }, variant === 'returned' && styles.struck]}>
        {isIncome ? '+' : '−'}
        {formatMoney(amount, currency)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  pressed: { opacity: 0.6 },
  middle: { flex: 1, gap: spacing.xxs },
  merchant: typography.subheading,
  meta: typography.caption,
  amount: typography.subheading,
  struck: { textDecorationLine: 'line-through' },
});
