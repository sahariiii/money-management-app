import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Loading, ToastProvider } from '@/components';
import { colors, fontWeight } from '@/constants/theme';

function requirePublishableKey(): string {
  const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error(
      'Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Add it to .env in the project root (see .env.example; Clerk Dashboard → API keys), ' +
        'then restart with `npx expo start --clear`.',
    );
  }
  return key;
}

const publishableKey = requirePublishableKey();

function RootStack() {
  const { isLoaded, isSignedIn } = useAuth();

  // Clerk first restores the session (secure store on native, browser storage on web).
  // Rendering routes before that would flash the sign-in screen for signed-in users.
  if (!isLoaded) return <Loading fullScreen />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: fontWeight.semibold },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}>
      {/* Signed out: only the auth screens. They're direct children (no (auth) layout), and
          signed-in users who land here are sent home. */}
      <Stack.Protected guard={!isSignedIn} redirectTo="/">
        <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/sign-up" options={{ headerShown: false }} />
        <Stack.Screen name="sso-callback" options={{ headerShown: false }} />
      </Stack.Protected>

      {/* Signed in: the tabs and every modal. Signed-out visits go to /sign-in. */}
      <Stack.Protected guard={isSignedIn} redirectTo="/sign-in">
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="upload-statement"
          options={{ presentation: 'modal', title: 'Upload statement' }}
        />
        <Stack.Screen name="scan-receipt" options={{ presentation: 'modal', title: 'Scan receipt' }} />
        <Stack.Screen name="transaction/[id]" options={{ presentation: 'modal', title: 'Transaction' }} />
        <Stack.Screen name="add-card" options={{ presentation: 'modal', title: 'Add card' }} />
        <Stack.Screen name="edit-card/[id]" options={{ presentation: 'modal', title: 'Edit card' }} />
        <Stack.Screen name="savings-goal" options={{ presentation: 'modal', title: 'Savings goal' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ToastProvider>
        <StatusBar style="dark" />
        <RootStack />
      </ToastProvider>
    </ClerkProvider>
  );
}
