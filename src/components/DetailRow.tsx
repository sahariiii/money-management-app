import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/constants/theme';

type Props = {
  label: string;
  value: string;
  tone?: 'income' | 'expense' | 'warning';
  /** Bigger, bolder row, e.g. a total. */
  strong?: boolean;
};

/** Label on the left, value on the right. Long values wrap instead of overflowing. */
export function DetailRow({ label, value, tone, strong }: Props) {
  return (
    <View style={styles.row}>
      <Text style={strong ? styles.labelStrong : styles.label}>{label}</Text>
      <Text style={[strong ? styles.valueStrong : styles.value, tone && { color: colors[tone] }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.lg },
  label: typography.muted,
  labelStrong: typography.subheading,
  value: { ...typography.label, flexShrink: 1, textAlign: 'right' },
  valueStrong: { ...typography.heading, flexShrink: 1, textAlign: 'right' },
});
