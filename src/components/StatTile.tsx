import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, layout, radius, spacing, type ColorToken } from '@/constants/theme';
import { Card } from './Card';

type Props = {
  label: string;
  value: string;
  caption?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  tone?: Extract<ColorToken, 'primary' | 'income' | 'expense' | 'warning'>;
};

const softTone = {
  primary: colors.primarySoft,
  income: colors.incomeSoft,
  expense: colors.expenseSoft,
  warning: colors.warningSoft,
} as const;

/** Compact KPI tile. Place several in a flex-wrap row; each grows to fill. */
export function StatTile({ label, value, caption, icon, tone = 'primary' }: Props) {
  return (
    <Card style={styles.tile}>
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
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {caption && <Text style={styles.caption}>{caption}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: 160, gap: spacing.sm },
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
