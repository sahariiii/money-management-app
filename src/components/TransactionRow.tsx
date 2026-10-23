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
  currency?: string;
  onPress?: () => void;
};

export function TransactionRow({ merchant, category, subtitle, amount, isIncome, currency, onPress }: Props) {
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
      <Text style={[styles.amount, { color: isIncome ? colors.income : colors.expense }]}>
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
});
