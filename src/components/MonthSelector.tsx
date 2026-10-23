import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';
import { formatMonth } from '@/lib/dates';
import type { YearMonth } from '@/types';

type Props = {
  months: YearMonth[];
  value: YearMonth;
  onChange: (month: YearMonth) => void;
};

export function MonthSelector({ months, value, onChange }: Props) {
  const i = months.indexOf(value);
  const prev = i > 0 ? months[i - 1] : undefined;
  const next = i >= 0 && i < months.length - 1 ? months[i + 1] : undefined;

  const arrow = (target: YearMonth | undefined, icon: 'chevron-back' | 'chevron-forward', label: string) => (
    <Pressable
      onPress={() => target && onChange(target)}
      disabled={!target}
      hitSlop={spacing.sm}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
      <Ionicons name={icon} size={layout.iconSize - 4} color={target ? colors.text : colors.border} />
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      {arrow(prev, 'chevron-back', 'Previous month')}
      <Text style={styles.label}>{formatMonth(value)}</Text>
      {arrow(next, 'chevron-forward', 'Next month')}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  arrow: { padding: spacing.xs + spacing.xxs },
  pressed: { opacity: 0.5 },
  label: {
    minWidth: 120,
    textAlign: 'center',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
});
