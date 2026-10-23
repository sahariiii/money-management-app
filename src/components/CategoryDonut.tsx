import { StyleSheet, Text, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { categoryColors, colors, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';
import { categoryColor } from '@/lib/categories';
import { formatMoney, formatMoneyWhole } from '@/lib/format';
import type { CategorySpend } from '@/types';

type Props = {
  data: CategorySpend[];
  /** Legend sits beside the donut instead of below it. */
  horizontal?: boolean;
  /** Categories beyond this are folded into one "Everything else" slice. */
  maxSlices?: number;
};

export function CategoryDonut({ data, horizontal = false, maxSlices = 6 }: Props) {
  const total = data.reduce((s, c) => s + c.amount, 0);
  const top = data.slice(0, maxSlices);
  const rest = data.slice(maxSlices).reduce((s, c) => s + c.amount, 0);
  const slices = [
    ...top.map((c) => ({ label: c.category as string, amount: c.amount, color: categoryColor(c.category) })),
    ...(rest > 0 ? [{ label: 'Everything else', amount: rest, color: categoryColors.Other }] : []),
  ];

  return (
    <View style={[styles.wrap, horizontal && styles.wrapHorizontal]}>
      <PieChart
        donut
        data={slices.map((s) => ({ value: s.amount, color: s.color }))}
        radius={layout.donutRadius}
        innerRadius={layout.donutRadius * 0.64}
        innerCircleColor={colors.card}
        centerLabelComponent={() => (
          <View style={styles.center}>
            <Text style={styles.centerValue}>{formatMoneyWhole(total)}</Text>
            <Text style={styles.centerLabel}>spent</Text>
          </View>
        )}
      />
      <View style={styles.legend}>
        {slices.map((s) => (
          <View key={s.label} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {s.label}
            </Text>
            <Text style={styles.legendValue}>{formatMoney(s.amount)}</Text>
            <Text style={styles.legendShare}>{total ? Math.round((s.amount / total) * 100) : 0}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.lg },
  wrapHorizontal: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center' },
  centerValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  centerLabel: { fontSize: fontSize.xs, color: colors.muted },
  legend: { flex: 1, alignSelf: 'stretch', gap: spacing.sm, justifyContent: 'center' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: spacing.md - 2, height: spacing.md - 2, borderRadius: radius.pill },
  legendLabel: { flex: 1, fontSize: fontSize.sm, color: colors.text },
  legendValue: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.medium },
  legendShare: { width: spacing.xxl + spacing.xs, textAlign: 'right', fontSize: fontSize.xs, color: colors.muted },
});
