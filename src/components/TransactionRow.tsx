import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';
import { formatMoney } from '@/lib/format';

type Props = {
  merchant: string;
  category: string;
  date: string;
  /** Signed amount: negative = expense, positive = income. */
  amount: number;
  currency?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  onPress?: () => void;
};

export function TransactionRow({
  merchant,
  category,
  date,
  amount,
  currency,
  icon = 'receipt-outline',
  onPress,
}: Props) {
  const isIncome = amount > 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.avatar, isIncome && styles.avatarIncome]}>
        <Ionicons name={icon} size={layout.iconSize - 4} color={isIncome ? colors.income : colors.primary} />
      </View>
      <View style={styles.middle}>
        <Text style={styles.merchant} numberOfLines={1}>
          {merchant}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {category} · {date}
        </Text>
      </View>
      <Text style={[styles.amount, { color: isIncome ? colors.income : colors.text }]}>
        {isIncome ? '+' : '−'}
        {formatMoney(Math.abs(amount), currency)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  pressed: { opacity: 0.6 },
  avatar: {
    width: layout.avatarSize,
    height: layout.avatarSize,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIncome: { backgroundColor: colors.incomeSoft },
  middle: { flex: 1, gap: spacing.xxs },
  merchant: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.semibold },
  meta: { fontSize: fontSize.xs, color: colors.muted },
  amount: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
