import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { colors, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';

type Props = Omit<TextInputProps, 'style'> & {
  label: string;
  error?: string;
  hint?: string;
  /** Shown inside the field before the value, e.g. "$" or "•••• ". */
  prefix?: string;
  suffix?: string;
  style?: StyleProp<ViewStyle>;
};

export function TextField({ label, error, hint, prefix, suffix, style, ...input }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, !!error && styles.fieldError]}>
        {prefix && <Text style={styles.affix}>{prefix}</Text>}
        <TextInput
          placeholderTextColor={colors.muted}
          style={styles.input}
          accessibilityLabel={label}
          {...input}
        />
        {suffix && <Text style={styles.affix}>{suffix}</Text>}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.inputHeight,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    gap: spacing.xs,
  },
  fieldError: { borderColor: colors.expense },
  input: { flex: 1, minWidth: 0, fontSize: fontSize.md, color: colors.text, paddingVertical: spacing.sm },
  affix: { fontSize: fontSize.md, color: colors.muted },
  error: { fontSize: fontSize.xs, color: colors.expense },
  hint: { fontSize: fontSize.xs, color: colors.muted },
});
