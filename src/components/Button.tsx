import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { borderWidth, colors, fontSize, radius, spacing, typography } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ComponentProps<typeof Ionicons>['name'];
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const variants = {
  primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
  secondary: { bg: colors.card, fg: colors.text, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  danger: { bg: colors.card, fg: colors.expense, border: colors.expenseSoft },
} as const;

export function Button({ label, onPress, variant = 'primary', size = 'md', icon, loading, disabled, style }: Props) {
  const v = variants[variant];
  const small = size === 'sm';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        small ? styles.sm : styles.md,
        { backgroundColor: v.bg, borderColor: v.border },
        (pressed || disabled) && styles.dim,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        icon && <Ionicons name={icon} size={small ? fontSize.sm : fontSize.md} color={v.fg} />
      )}
      <Text style={[small ? styles.labelSm : styles.label, { color: v.fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + spacing.xxs,
    borderRadius: radius.pill,
    borderWidth: borderWidth.thin,
  },
  md: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sm: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + spacing.xxs },
  dim: { opacity: 0.7 },
  label: typography.subheading,
  labelSm: typography.label,
});
