import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fontSize, fontWeight, layout, radius, spacing, type ColorToken } from '@/constants/theme';
import { Card } from './Card';

type Props = {
  label: string;
  value: string;
  caption?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  tone?: Extract<ColorToken, 'primary' | 'income' | 'expense' | 'warning'>;
  /** Color the value with the tone (e.g. positive/negative net). */
  tintValue?: boolean;
  style?: StyleProp<ViewStyle>;
};

const softTone = {
  primary: colors.primarySoft,
  income: colors.incomeSoft,
  expense: colors.expenseSoft,
  warning: colors.warningSoft,
} as const;

/** Compact KPI tile. Place several in a flex-wrap row; each grows to fill. */
export function StatTile({ label, value, caption, icon, tone = 'primary', tintValue, style }: Props) {
  return (
    <Card style={[styles.tile, style]}>
      <View style={styles.header}>
        {icon && (
          <View style={[styles.iconWrap, { backgroundColor: softTone[tone] }]}>
            <Ionicons name={icon} size={fontSize.md} color={colors[tone]} />
          </View>
        )}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.value, tintValue && { color: colors[tone] }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {caption && <Text style={styles.caption}>{caption}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconWrap: {
    width: layout.iconSize + spacing.sm,
    height: layout.iconSize + spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, fontSize: fontSize.sm, color: colors.muted, fontWeight: fontWeight.medium },
  value: { fontSize: fontSize.xl, color: colors.text, fontWeight: fontWeight.bold },
  caption: { fontSize: fontSize.xs, color: colors.muted },
});
