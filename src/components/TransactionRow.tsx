import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';
import { categoryColor, categoryIcon } from '@/lib/categories';
import { formatMoney } from '@/lib/format';
import type { Category } from '@/types';

type Props = {
  merchant: string;
  category: Category;
  /** Secondary line, e.g. "Food · Visa •••• 7392". */
  subtitle: string;
  /** Always positive; direction comes from isIncome. */
  amount: number;
  isIncome: boolean;
  currency?: string;
  onPress?: () => void;
};

export function TransactionRow({ merchant, category, subtitle, amount, isIncome, currency, onPress }: Props) {
  const tint = categoryColor(category);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.avatar, { borderColor: tint }]}>
        <Ionicons name={categoryIcon(category)} size={layout.iconSize - 4} color={tint} />
      </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  avatar: {
    width: layout.avatarSize,
    height: layout.avatarSize,
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, gap: spacing.xxs },
  merchant: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.semibold },
  meta: { fontSize: fontSize.xs, color: colors.muted },
  amount: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
