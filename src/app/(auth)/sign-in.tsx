import { useSignIn, useSSO } from '@clerk/expo';
import * as AuthSession from 'expo-auth-session';
import { Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { AlertBanner, AuthScreen, Button, CodeForm, TextField, useToast } from '@/components';
import { colors, spacing, typography } from '@/constants/theme';
import {
  authError,
  authGlobalError,
  goHomeAfterAuth,
  missingFieldsMessage,
  useClearLeftoverSession,
} from '@/lib/auth';

const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s);

/** Preloads the browser on Android so the Google sheet opens faster. */
function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

/** Readable text for a failed Google attempt. Cancelling isn't an error and never gets here. */
function googleError(err: unknown) {
  if ((err as { code?: string })?.code === 'ERR_WEB_BROWSER_BLOCKED') {
    return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
  }
  return authGlobalError([err]) ?? "Google sign-in didn't finish. Try again.";
}

export default function SignIn() {
  useWarmUpBrowser();
  useClearLeftoverSession();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState<{ email?: string; password?: string }>({});
  // Problems that don't come from the form's `errors`: Google, unsupported steps.
  const [notice, setNotice] = useState<string>();
  const [googleBusy, setGoogleBusy] = useState(false);

  const busy = fetchStatus === 'fetching';
  const finish = () => signIn.finalize({ navigate: goHomeAfterAuth(setNotice) });

  async function onSubmit() {
    setNotice(undefined);
    const problems = {
      email: isEmail(email.trim()) ? undefined : 'Enter your email address.',
      password: password ? undefined : 'Enter your password.',
    };
    setInvalid(problems);
    if (problems.email || problems.password) return;

    const { error } = await signIn.password({ emailAddress: email.trim(), password });
    if (error) return; // Shown through `errors` below.

    if (signIn.status === 'complete') {
      await finish();
    } else if (signIn.status === 'needs_client_trust') {
      // New device: Clerk wants an emailed code before it trusts it. The screen switches on status.
      const emailCode = signIn.supportedSecondFactors.find((f) => f.strategy === 'email_code');
      if (emailCode) await signIn.mfa.sendEmailCode();
      else setNotice("This device needs a verification method this app doesn't support yet.");
    } else if (signIn.status === 'needs_second_factor') {
      setNotice("This account uses two-step verification, which this app doesn't support yet.");
    } else {
      setNotice("Sign-in didn't finish. Try again.");
    }
  }

  async function onVerify() {
    const { error } = await signIn.mfa.verifyEmailCode({ code });
    if (error) return;
    if (signIn.status === 'complete') await finish();
  }

  async function onResend() {
    const { error } = await signIn.mfa.sendEmailCode();
    if (!error) toast(`New code sent to ${email.trim()}`);
  }

  async function onStartOver() {
    await signIn.reset();
    setCode('');
  }

  async function onGoogle() {
    setNotice(undefined);
    setGoogleBusy(true);
    try {
      // Expo Go: exp://<your-ip>:8081/--/sso-callback · web: <origin>/sso-callback.
      // Native redirect URLs must be allowlisted in Clerk → Native applications, or no session is created.
      const redirectUrl = AuthSession.makeRedirectUri({ path: 'sso-callback' });
      if (__DEV__ && Platform.OS !== 'web') console.log('[Clerk] Google redirect URL:', redirectUrl);

      const { createdSessionId, setActive, signUp } = await startSSOFlow({ strategy: 'oauth_google', redirectUrl });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId, navigate: goHomeAfterAuth(setNotice) });
      } else if (signUp?.status === 'missing_requirements') {
        setNotice(missingFieldsMessage(signUp.missingFields));
      }
      // Otherwise the user closed the Google window: nothing to show.
    } catch (err) {
      setNotice(googleError(err));
    } finally {
      setGoogleBusy(false);
    }
  }

  const formError = notice ?? authGlobalError(errors.global);

  if (signIn.status === 'needs_client_trust') {
    return (
      <AuthScreen title="Check your email" subtitle={`We sent a 6-digit code to ${email.trim()} to confirm it's you.`}>
        {formError && <AlertBanner tone="danger" title={formError} />}
        <CodeForm
          code={code}
          onChangeCode={setCode}
          error={authError(errors.fields.code)}
          busy={busy}
          onVerify={onVerify}
          onResend={onResend}
          onStartOver={onStartOver}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Money Agent"
      subtitle="Upload statements and receipts. Get one ledger, smart budgets, bill alerts and an assistant that knows your habits.">
      {formError && <AlertBanner tone="danger" title={formError} />}

      <Button
        label="Continue with Google"
        icon="logo-google"
        variant="secondary"
        onPress={onGoogle}
        loading={googleBusy}
        disabled={busy}
      />

      <View style={styles.or}>
        <View style={styles.line} />
        <Text style={styles.orText}>or</Text>
        <View style={styles.line} />
      </View>

      <TextField
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        error={invalid.email ?? authError(errors.fields.identifier)}
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        error={invalid.password ?? authError(errors.fields.password)}
      />
      <Button label="Sign in" onPress={onSubmit} loading={busy} disabled={googleBusy} />

      <Text style={styles.footer}>
        New here?{' '}
        <Link href="/sign-up" replace style={styles.link}>
          Create an account
        </Link>
      </Text>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  or: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  orText: typography.caption,
  footer: { ...typography.muted, textAlign: 'center' },
  link: { ...typography.label, color: colors.primary },
});
