import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Screen } from '@/components';
import { colors, fontSize, layout, radius, spacing, typography } from '@/constants/theme';
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
          Upload statements and receipts. Get one ledger, smart budgets, bill alerts and an assistant that knows your
          habits.
        </Text>
      </View>

      <Button
        label="Continue with Google"
        icon="logo-google"
        variant="secondary"
        onPress={handleContinue}
        style={styles.button}
      />
      <Text style={styles.footnote}>Demo mode · no account is created</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', alignItems: 'center', gap: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.md },
  logo: { padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primary, marginBottom: spacing.sm },
  title: typography.title,
  subtitle: { ...typography.bodyMuted, textAlign: 'center', maxWidth: layout.readableWidth },
  button: { width: '100%', maxWidth: layout.readableWidth },
  footnote: typography.caption,
});
