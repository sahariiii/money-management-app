import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';

type Tone = 'info' | 'warning' | 'danger' | 'success';

type Action = { label: string; onPress: () => void };

type Props = {
  title: string;
  message?: string;
  tone?: Tone;
  /** First action is emphasized; the rest are plain text buttons. */
  actions?: Action[];
};

const toneStyles = {
  info: { bg: colors.primarySoft, fg: colors.primary, icon: 'information-circle' },
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: 'alert-circle' },
  danger: { bg: colors.expenseSoft, fg: colors.expense, icon: 'warning' },
  success: { bg: colors.incomeSoft, fg: colors.income, icon: 'checkmark-circle' },
} as const;

export function AlertBanner({ title, message, tone = 'info', actions = [] }: Props) {
  const t = toneStyles[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]} accessibilityRole="alert">
      <Ionicons name={t.icon} size={layout.iconSize} color={t.fg} />
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
        {actions.length > 0 && (
          <View style={styles.actions}>
            {actions.map((a, i) => (
              <Pressable
                key={a.label}
                onPress={a.onPress}
                hitSlop={spacing.xs}
                accessibilityRole="button"
                style={({ pressed }) => [i === 0 && [styles.primary, { borderColor: t.fg }], pressed && styles.pressed]}>
                <Text style={[styles.action, { color: i === 0 ? t.fg : colors.muted }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  body: { flex: 1, gap: spacing.xxs },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  message: { fontSize: fontSize.sm, color: colors.muted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.sm },
  primary: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pressed: { opacity: 0.6 },
  action: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
