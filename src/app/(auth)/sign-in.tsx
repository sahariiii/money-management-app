import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components';
import { colors, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';
import { useSession } from '@/lib/session';

export default function SignIn() {
  const { signIn } = useSession();

  const handleContinue = () => {
    // Fake auth for the UI phase; Clerk Google sign-in replaces this later.
    signIn();
    router.replace('/');
  };

  return (
    <Screen edges={['top', 'bottom']} contentStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Ionicons name="wallet" size={fontSize.display} color={colors.onPrimary} />
        </View>
        <Text style={styles.title}>Money Agent</Text>
        <Text style={styles.subtitle}>
          Upload statements and receipts. Get one ledger, smart budgets, bill alerts and an
          assistant that knows your habits.
        </Text>
      </View>

      <Pressable
        onPress={handleContinue}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Ionicons name="logo-google" size={layout.iconSize - 2} color={colors.text} />
        <Text style={styles.buttonLabel}>Continue with Google</Text>
      </Pressable>
      <Text style={styles.footnote}>Demo mode · no account is created</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', alignItems: 'center', gap: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.md },
  logo: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    marginBottom: spacing.sm,
  },
  title: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: layout.readableWidth,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    width: '100%',
    maxWidth: layout.readableWidth,
    paddingVertical: spacing.md + spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  pressed: { opacity: 0.8 },
  buttonLabel: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  footnote: { fontSize: fontSize.xs, color: colors.muted },
});
