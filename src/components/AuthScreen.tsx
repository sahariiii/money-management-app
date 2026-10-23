import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, layout, radius, spacing, typography } from '@/constants/theme';

import { Screen } from './Screen';

type Props = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

/** Centered logo, title and a form column at readable width. Used by sign-in and sign-up. */
export function AuthScreen({ title, subtitle, children }: Props) {
  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Ionicons name="wallet" size={fontSize.display} color={colors.onPrimary} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <View style={styles.form}>{children}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', alignItems: 'center', gap: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.md },
  logo: { padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primary, marginBottom: spacing.sm },
  title: { ...typography.title, textAlign: 'center' },
  subtitle: { ...typography.bodyMuted, textAlign: 'center', maxWidth: layout.readableWidth },
  form: { width: '100%', maxWidth: layout.readableWidth, gap: spacing.lg },
});
