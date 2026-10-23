import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/constants/theme';

type Props = {
  title: string;
  subtitle?: string;
  /** A text link on the right. */
  actionLabel?: string;
  onAction?: () => void;
  /** Any element on the right instead of a text link, e.g. a Button. */
  right?: ReactNode;
};

export function SectionHeader({ title, subtitle, actionLabel, onAction, right }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {right ??
          (actionLabel && onAction && (
            <Pressable onPress={onAction} hitSlop={spacing.sm} accessibilityRole="button">
              <Text style={styles.action}>{actionLabel}</Text>
            </Pressable>
          ))}
      </View>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xxs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { ...typography.heading, flexShrink: 1 },
  subtitle: typography.caption,
  action: { ...typography.label, color: colors.primary },
});
