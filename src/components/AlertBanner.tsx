import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { borderWidth, colors, layout, radius, spacing, typography } from '@/constants/theme';

type Tone = 'info' | 'warning' | 'danger' | 'success';

type Action = { label: string; onPress: () => void };

type Props = {
  title: string;
  message?: string;
  tone?: Tone;
  /** First action is emphasized; the rest are plain text buttons. */
  actions?: Action[];
  /** Greyed out, e.g. a dismissed alert in a history list. */
  muted?: boolean;
  /** Small status line under the message, e.g. "Dismissed". */
  meta?: string;
};

const toneStyles = {
  info: { bg: colors.primarySoft, fg: colors.primary, icon: 'information-circle' },
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: 'alert-circle' },
  danger: { bg: colors.expenseSoft, fg: colors.expense, icon: 'warning' },
  success: { bg: colors.incomeSoft, fg: colors.income, icon: 'checkmark-circle' },
} as const;

export function AlertBanner({ title, message, tone = 'info', actions = [], muted = false, meta }: Props) {
  const t = toneStyles[tone];
  const bg = muted ? colors.track : t.bg;
  const fg = muted ? colors.muted : t.fg;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole={muted ? undefined : 'alert'}>
      <Ionicons name={t.icon} size={layout.iconSize} color={fg} />
      <View style={styles.body}>
        <Text style={[styles.title, muted && styles.mutedText]}>{title}</Text>
        {message && <Text style={styles.message}>{message}</Text>}
        {meta && <Text style={styles.meta}>{meta}</Text>}
        {actions.length > 0 && (
          <View style={styles.actions}>
            {actions.map((a, i) => (
              <Pressable
                key={a.label}
                onPress={a.onPress}
                hitSlop={spacing.xs}
                accessibilityRole="button"
                style={({ pressed }) => [i === 0 && [styles.primary, { borderColor: fg }], pressed && styles.pressed]}>
                <Text style={[styles.action, { color: i === 0 ? fg : colors.muted }]}>{a.label}</Text>
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
  title: typography.label,
  mutedText: { color: colors.muted },
  message: typography.muted,
  meta: { ...typography.caption, marginTop: spacing.xxs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg, marginTop: spacing.sm },
  primary: {
    borderWidth: borderWidth.thin,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pressed: { opacity: 0.6 },
  action: typography.label,
});
