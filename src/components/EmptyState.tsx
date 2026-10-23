import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, layout, radius, spacing, typography } from '@/constants/theme';
import { Button } from './Button';

type Props = {
  title: string;
  message?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  actionLabel?: string;
  onAction?: () => void;
  /** Less vertical padding, for empty states inside a card. */
  compact?: boolean;
};

export function EmptyState({ title, message, icon = 'file-tray-outline', actionLabel, onAction, compact }: Props) {
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={compact ? fontSize.xl : fontSize.xxl} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
      {actionLabel && onAction && <Button label={actionLabel} onPress={onAction} style={styles.button} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  compact: { flexGrow: 0, paddingVertical: spacing.lg, paddingHorizontal: spacing.md },
  iconWrap: {
    padding: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    marginBottom: spacing.sm,
  },
  title: { ...typography.heading, textAlign: 'center' },
  message: { ...typography.muted, textAlign: 'center', maxWidth: layout.readableWidth },
  button: { marginTop: spacing.md },
});
