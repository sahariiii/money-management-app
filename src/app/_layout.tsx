import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ToastProvider } from '@/components';
import { colors, fontWeight } from '@/constants/theme';
import { SessionProvider, useSession } from '@/lib/session';

function RootStack() {
  const { signedIn } = useSession();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: fontWeight.semibold },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}>
      {/* Signed out: sign-in is the only screen, so the app opens on it. It's a direct
          child (no (auth) layout) so the guard redirects to /sign-in, not /(auth). */}
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)/sign-in" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="upload-statement"
          options={{ presentation: 'modal', title: 'Upload statement' }}
        />
        <Stack.Screen name="scan-receipt" options={{ presentation: 'modal', title: 'Scan receipt' }} />
        <Stack.Screen name="transaction/[id]" options={{ presentation: 'modal', title: 'Transaction' }} />
        <Stack.Screen name="add-card" options={{ presentation: 'modal', title: 'Add card' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <ToastProvider>
        <StatusBar style="dark" />
        <RootStack />
      </ToastProvider>
    </SessionProvider>
  );
}
