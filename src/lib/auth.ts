// Helpers shared by the Clerk sign-in and sign-up screens.

import { isClerkAPIResponseError, useClerk } from '@clerk/expo';
import type { SetActiveNavigate } from '@clerk/expo/types';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

type ClerkFieldError = { code: string; message: string; longMessage?: string };

/** Clerk error codes rewritten in the app's voice. Anything else shows Clerk's own message. */
const FRIENDLY: Record<string, string> = {
  form_identifier_not_found: "We couldn't find an account with that email. Check it, or create an account.",
  form_password_incorrect: "That password isn't right. Try again.",
  form_identifier_exists: 'An account with this email already exists. Sign in instead.',
  form_password_pwned: 'This password has shown up in a data breach. Choose a different one.',
  strategy_for_user_invalid: 'This account signs in with Google. Use "Continue with Google" instead.',
  form_code_incorrect: "That code isn't right. Check the email and try again.",
  verification_expired: 'That code has expired. Send a new one.',
  verification_failed: 'Too many wrong codes. Send a new one.',
  session_exists: 'This device still had an old session. Reload the app and try again.',
};

/** A readable message for one Clerk field error (e.g. `errors.fields.password`). */
export function authError(error: ClerkFieldError | null | undefined): string | undefined {
  if (!error) return undefined;
  return FRIENDLY[error.code] ?? error.longMessage ?? error.message;
}

/** A readable message for an error that isn't tied to a field, or one thrown by a call. */
export function authGlobalError(errors: readonly unknown[] | null | undefined): string | undefined {
  const first = errors?.[0];
  if (!first) return undefined;
  if (isClerkAPIResponseError(first)) return authError(first.errors[0]) ?? first.message;
  if (first instanceof Error) return (first as Error & { longMessage?: string }).longMessage ?? first.message;
  return 'Something went wrong. Try again.';
}

const FIELD_NAMES: Record<string, string> = {
  phone_number: 'phone number',
  username: 'username',
  first_name: 'first name',
  last_name: 'last name',
  legal_accepted: 'terms acceptance',
};

/** Shown when the Clerk instance requires sign-up fields this app doesn't collect. */
export function missingFieldsMessage(fields: readonly string[]): string {
  const names = fields.map((f) => FIELD_NAMES[f] ?? f.replace(/_/g, ' '));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `Creating an account also needs a ${list}, which this app doesn't ask for yet.`;
}

/**
 * Auth screens only show while useAuth() says signed out, but Clerk can still hold a session for
 * this device (e.g. a pending one from an unfinished attempt). Then every sign-in or sign-up fails
 * with "session_exists". Clear it on arrival so the forms work.
 */
export function useClearLeftoverSession() {
  const clerk = useClerk();
  useEffect(() => {
    if (!clerk.client?.sessions.length) return;
    // Web: reload this page once signed out. Native: Clerk doesn't navigate.
    void clerk.signOut({ redirectUrl: Platform.OS === 'web' ? window.location.pathname : undefined });
  }, [clerk]);
}

/**
 * The `navigate` callback for finalize() / setActive(): go home once the session is active.
 * Session tasks (e.g. forced MFA setup) aren't built here, so they surface as a message instead.
 */
export function goHomeAfterAuth(onBlocked: (message: string) => void): SetActiveNavigate {
  return ({ session, decorateUrl }) => {
    if (session?.currentTask) {
      onBlocked(`Your account needs one more step (${session.currentTask.key}) that this app doesn't support yet.`);
      return;
    }
    const url = decorateUrl('/');
    // On web, Clerk may hand back a full URL that has to be loaded (Safari cookie refresh).
    if (url.startsWith('http')) window.location.href = url;
    else router.replace(url as Href);
  };
}
