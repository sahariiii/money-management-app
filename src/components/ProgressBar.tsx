import { StyleSheet, View } from 'react-native';

import { colors, layout, radius } from '@/constants/theme';

type Props = {
  /** Fraction used, e.g. spent / budget. Values above 1 are clamped visually. */
  value: number;
};

export function progressColor(value: number) {
  if (value >= 1) return colors.expense;
  if (value >= 0.8) return colors.warning;
  return colors.primary;
}

export function ProgressBar({ value }: Props) {
  const pct = Math.max(0, Math.min(value, 1)) * 100;
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: progressColor(value) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: layout.progressHeight,
    borderRadius: radius.pill,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill },
});
