import { StyleSheet, View, type TextStyle } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';

import { colors, fontSize, layout, spacing } from '@/constants/theme';
import { formatShortDate } from '@/lib/dates';
import { formatMoneyWhole } from '@/lib/format';
import type { WeekTotals } from '@/types';

type Props = {
  data: WeekTotals[];
  /** Available width for the whole chart, including the y-axis labels. */
  width: number;
  /** Plot height; defaults to layout.chartHeight. */
  height?: number;
};

const Y_AXIS_WIDTH = 44;
const EDGE = spacing.md;
const X_LABEL_WIDTH = 48;
/** First point sits half a label in, so its date isn't clipped at the left edge. */
const INITIAL = X_LABEL_WIDTH / 2;

export function WeeklySpendChart({ data, width, height = layout.chartHeight }: Props) {
  const plotWidth = Math.max(width - Y_AXIS_WIDTH - EDGE, 100);
  const step = data.length > 1 ? (plotWidth - INITIAL) / (data.length - 1) : plotWidth;
  // Label every other week on narrow charts so dates don't collide.
  const labelEvery = Math.ceil(X_LABEL_WIDTH / step);
  // gifted-charts sizes each label box to `spacing + labelsExtraHeight` (despite the
  // name, it's extra width), anchored at the point's left edge. Widen it so dates
  // aren't truncated and pull the text back left by half to stay centered.
  const extra = Math.max(0, X_LABEL_WIDTH - step);

  return (
    <View style={styles.wrap}>
      <LineChart
        data={data.map((w, i) => ({
          value: w.spent,
          label: i % labelEvery === 0 ? formatShortDate(w.weekStart) : '',
          // A fresh plain object per point: gifted-charts deep-clones data and
          // throws on frozen StyleSheet objects.
          labelTextStyle: { ...xLabelStyle, width: step + extra, marginLeft: -extra / 2 },
        }))}
        labelsExtraHeight={extra}
        width={plotWidth}
        height={height}
        spacing={step}
        initialSpacing={INITIAL}
        endSpacing={0}
        disableScroll
        areaChart
        curved
        thickness={2.5}
        color={colors.primary}
        startFillColor={colors.primary}
        endFillColor={colors.primary}
        startOpacity={0.25}
        endOpacity={0.02}
        dataPointsColor={colors.primary}
        noOfSections={4}
        yAxisLabelWidth={Y_AXIS_WIDTH}
        // Whole dollars on the axis: these are gridlines, not amounts.
        formatYLabel={(label) => formatMoneyWhole(Number(label))}
        yAxisTextStyle={styles.axisText}
        xAxisLabelTextStyle={styles.axisText}
        yAxisColor={colors.border}
        xAxisColor={colors.border}
        rulesColor={colors.track}
        rulesType="solid"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  axisText: { fontSize: fontSize.xxs, color: colors.muted },
});

const xLabelStyle: TextStyle = {
  textAlign: 'center',
  fontSize: fontSize.xxs,
  color: colors.muted,
};
