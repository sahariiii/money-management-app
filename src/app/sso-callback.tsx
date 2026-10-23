import { Loading } from '@/components';

/**
 * Where Google sends the user back to (the SSO redirect URL). ClerkProvider and the sign-in
 * screen finish the sign-in; this route only exists so the redirect doesn't land on
 * "Unmatched route" (Android deep link, and the web popup before it closes).
 */
export default function SSOCallback() {
  return <Loading fullScreen />;
}
