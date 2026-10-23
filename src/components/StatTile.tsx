import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fontSize, fontWeight, layout, radius, spacing, typography, type ColorToken } from '@/constants/theme';
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

/** Compact KPI tile. Give it a width; screens lay tiles out in a wrapping row. */
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
      {/* adjustsFontSizeToFit shrinks long amounts on Android; web ignores it and truncates with "…". */}
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
  label: { ...typography.muted, fontWeight: fontWeight.medium, flex: 1 },
  value: typography.stat,
  caption: typography.caption,
});
