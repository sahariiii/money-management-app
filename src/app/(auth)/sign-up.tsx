import { useSignUp } from '@clerk/expo';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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

export default function SignUp() {
  useClearLeftoverSession();
  const { signUp, errors, fetchStatus } = useSignUp();
  const toast = useToast();

  const [step, setStep] = useState<'details' | 'verify'>('details');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState<Partial<Record<'firstName' | 'lastName' | 'email' | 'password', string>>>(
    {},
  );
  const [notice, setNotice] = useState<string>();

  const busy = fetchStatus === 'fetching';

  // password() updates an existing sign-up attempt instead of creating one, and a leftover attempt
  // from an earlier visit may be gone on Clerk's side ("No sign up attempt was found"). Start every
  // visit fresh. This must happen before submit: reset() swaps in a new `signUp` on the next render,
  // so resetting inside onSubmit would still call password() on the stale one.
  useEffect(() => {
    if (signUp.id && signUp.status !== 'complete') void signUp.reset();
    // Only on arrival; later resets come from "Start over".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit() {
    setNotice(undefined);
    const problems = {
      firstName: firstName.trim() ? undefined : 'Enter your first name.',
      lastName: lastName.trim() ? undefined : 'Enter your last name.',
      email: isEmail(email.trim()) ? undefined : 'Enter a valid email address.',
      password: password ? undefined : 'Choose a password.',
    };
    setInvalid(problems);
    if (Object.values(problems).some(Boolean)) return;

    const { error } = await signUp.password({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      emailAddress: email.trim(),
      password,
    });
    if (error) return; // Shown through `errors` below.

    // Email verification is off in Clerk, so the sign-up is usually complete already. If it's
    // switched back on, fall back to the emailed-code step.
    if (signUp.status !== 'complete' && signUp.unverifiedFields.includes('email_address')) {
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (!sendError) setStep('verify');
      return;
    }
    await finishSignUp();
  }

  async function onVerify() {
    setNotice(undefined);
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (!error) await finishSignUp();
  }

  async function finishSignUp() {
    if (signUp.status === 'complete') {
      await signUp.finalize({ navigate: goHomeAfterAuth(setNotice) });
    } else {
      // The Clerk instance asks for more than email + password (e.g. a phone number).
      setNotice(
        signUp.missingFields.length > 0
          ? missingFieldsMessage(signUp.missingFields)
          : "Your account couldn't be created. Start over and try again.",
      );
    }
  }

  async function onResend() {
    const { error } = await signUp.verifications.sendEmailCode();
    if (!error) toast(`New code sent to ${email.trim()}`);
  }

  async function onStartOver() {
    await signUp.reset();
    setCode('');
    setNotice(undefined);
    setStep('details');
  }

  const formError = notice ?? authGlobalError(errors.global);

  if (step === 'verify') {
    return (
      <AuthScreen title="Check your email" subtitle={`We sent a 6-digit code to ${email.trim()}.`}>
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
    <AuthScreen title="Create your account" subtitle="One ledger for every statement and receipt.">
      {formError && <AlertBanner tone="danger" title={formError} />}

      <View style={styles.names}>
        <TextField
          style={styles.flex}
          label="First name"
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
          error={invalid.firstName ?? authError(errors.fields.firstName)}
        />
        <TextField
          style={styles.flex}
          label="Last name"
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
          autoComplete="family-name"
          textContentType="familyName"
          returnKeyType="next"
          error={invalid.lastName ?? authError(errors.fields.lastName)}
        />
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
        error={invalid.email ?? authError(errors.fields.emailAddress)}
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        error={invalid.password ?? authError(errors.fields.password)}
      />
      <Button label="Create account" onPress={onSubmit} loading={busy} />

      {/* Clerk mounts its bot-protection CAPTCHA here on web; it's skipped on iOS and Android. */}
      <View nativeID="clerk-captcha" />

      <Text style={styles.footer}>
        Already have an account?{' '}
        <Link href="/sign-in" replace style={styles.link}>
          Sign in
        </Link>
      </Text>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Side by side even on phones: the auth column is at most 400px wide.
  names: { flexDirection: 'row', gap: spacing.md },
  footer: { ...typography.muted, textAlign: 'center' },
  link: { ...typography.label, color: colors.primary },
});
