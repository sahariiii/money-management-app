import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

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
      {/* Signed out: only the auth group exists, so the app opens on sign-in. */}
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="upload-statement"
          options={{ presentation: 'modal', title: 'Upload statement' }}
        />
        <Stack.Screen name="scan-receipt" options={{ presentation: 'modal', title: 'Scan receipt' }} />
        <Stack.Screen name="transaction/[id]" options={{ presentation: 'modal', title: 'Transaction' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <RootStack />
    </SessionProvider>
  );
}
