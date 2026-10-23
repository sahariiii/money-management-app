import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';

type Tone = 'info' | 'warning' | 'danger' | 'success';

type Props = {
  title: string;
  message?: string;
  tone?: Tone;
  actionLabel?: string;
  onAction?: () => void;
};

const toneStyles = {
  info: { bg: colors.primarySoft, fg: colors.primary, icon: 'information-circle' },
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: 'alert-circle' },
  danger: { bg: colors.expenseSoft, fg: colors.expense, icon: 'warning' },
  success: { bg: colors.incomeSoft, fg: colors.income, icon: 'checkmark-circle' },
} as const;

export function AlertBanner({ title, message, tone = 'info', actionLabel, onAction }: Props) {
  const t = toneStyles[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]} accessibilityRole="alert">
      <Ionicons name={t.icon} size={layout.iconSize} color={t.fg} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
      </View>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} hitSlop={spacing.sm}>
          <Text style={[styles.action, { color: t.fg }]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  body: { flex: 1, gap: spacing.xxs },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  message: { fontSize: fontSize.xs, color: colors.muted },
  action: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
