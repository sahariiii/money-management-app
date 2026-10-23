@AGENTS.md

## Project
AI money agent app. Users upload bank statements and receipts; the app builds one ledger,
shows spending, budgets, bill alerts, a credit-card rewards optimizer, and an AI chat
assistant that remembers spending habits. Later the backend will be FastAPI (Python),
Clerk for auth, SurrealDB for the ledger, SurrealDB Agent Memory for long-term memory.

Current phase: UI + real auth (Clerk). No backend, no database: all app data is still mock data.

## Rules
- Expo + Expo Router + TypeScript. Must run on Android (Expo Go) AND web.
- Install Expo packages with `npx expo install`, never plain `npm install`, so versions match the SDK.
- Styling: plain StyleSheet using tokens from src/constants/theme.ts. No hardcoded colors or spacing in screens.
- All data access goes through src/lib/api.ts (async functions returning mock data from src/data/mock.ts).
  Screens never import mock data directly. Later lib/api.ts gets replaced with real fetch calls.
- Every screen must work at phone width and on a wide desktop browser (content max width ~900px, centered).
- Never store or display full card numbers: last 4 digits only.
- After each change, run `npx tsc --noEmit` and fix all errors.

## Layout
This project uses the `src/` layout (import alias `@/*` -> `src/*`):
- src/app/ — routes only (Expo Router). `(auth)/sign-in`, `(auth)/sign-up`, `sso-callback`,
  `(tabs)/` with 5 tabs (index, transactions, chat, cards, more), modals: upload-statement,
  scan-receipt, transaction/[id], add-card. New modal routes must also be registered in
  src/app/_layout.tsx, inside the signed-in `Stack.Protected` group.
- Mocked "AI" features live in api.ts: chat answers (on-track, restaurants, which card),
  uploadStatement (always 40 latest rows, all already in ledger), scanReceipt (always matches
  the Gusto 101 transaction). Pickers (expo-document-picker / expo-image-picker) are real.
- src/components/ — shared UI (Screen, Card, StatTile, ProgressBar, TransactionRow, AlertBanner,
  Chip, SectionHeader, EmptyState, AuthScreen, CodeForm, Avatar). Import from `@/components`.
- src/constants/theme.ts — design tokens (colors, spacing, radius, fontSize, layout).
- src/types.ts — domain types mirroring the future DB, plus API response shapes and CATEGORIES.
- src/lib/api.ts — the only data layer. Async, fake delay, in-memory copy of mock data
  (recategorize/dismiss persist per session). Summaries, budgets, optimizer and chat answers
  are computed from transactions, never hardcoded. `today()` returns the demo date.
- src/lib/auth.ts — Clerk helpers for the auth screens: readable error messages, the
  `navigate` callback for finalize()/setActive().
- src/data/mock.ts — seeded, deterministic Aug 1 – Oct 22 2026 Canadian data. Demo "today"
  is 2026-10-23. Planned demo moments: groceries mostly on debit, Rogers $65 → $200 in Oct,
  messy raw descriptions, Food budget ~85% in Oct, biweekly payroll.

## Auth (Clerk)
- Package `@clerk/expo` v4 (custom flows, JS only: works in Expo Go and on web; no native
  components, nothing that needs a dev build). Key: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in .env
  (gitignored). Follow `.agents/skills/clerk-expo` (installed with `npx skills add clerk/skills`),
  but it was written for v3.6: check `node_modules/@clerk/expo` types when they disagree.
- src/app/_layout.tsx: `<ClerkProvider tokenCache>` → `<ToastProvider>` → RootStack. RootStack shows
  a full-screen spinner until `useAuth().isLoaded` (no sign-in flash; also what web SSR renders),
  then two `Stack.Protected` groups: signed-out (sign-in, sign-up, sso-callback; `redirectTo="/"`)
  and signed-in (tabs + modals; `redirectTo="/sign-in"`).
- Email/password uses the current hooks: `useSignIn()` / `useSignUp()` return
  `{ signIn|signUp, errors, fetchStatus }`, methods return `{ error }`, finish with
  `finalize({ navigate })`. Never the legacy `signIn.create` + `prepareFirstFactor` + `setActive`.
  Sign-in handles `needs_client_trust` (new-device email code). Sign-up collects first name, last
  name, email and password (the greeting uses `user.firstName`); email verification is off in Clerk,
  so it usually completes at once, with the emailed-code step kept as a fallback. Sign-up renders
  `<View nativeID="clerk-captcha" />`. Both auth screens clear a leftover (e.g. pending) session on
  arrival, or Clerk rejects new attempts with `session_exists`.
- Google = `useSSO()` from `@clerk/expo` (browser OAuth: Custom Tab on Android, popup on web), then
  `setActive({ session, navigate })`. Don't call `WebBrowser.maybeCompleteAuthSession()`;
  ClerkProvider does it on web.
- User data: `useUser()` (home greeting, More → Profile). More → Profile (`ProfileCard` in more.tsx)
  edits first/last name with `user.update()`. Sign out: `useClerk().signOut()`.
- Backend prep in api.ts: `apiFetch()` sends `Authorization: Bearer <Clerk session token>`
  (`getAuthToken()` via `getClerkInstance()`). `USE_MOCK = true`; functions don't branch on it yet.
  Never send a user ID: the FastAPI backend must verify the token and take the user from it.

## Gotchas
- Clerk dashboard settings matter (instance logical-sole-3210, dev): phone number and username are
  off, email verification at sign-up is off, first/last name are on. Turning a requirement back on
  makes sign-up end in a "missing fields" message. Passwords need 15+ characters on this instance.
  Google in Expo Go only creates a session if the redirect URL (`exp://<LAN-IP>:8081/--/sso-callback`,
  logged in the Metro console in dev) is allowlisted under Native applications.
- Typed routes (.expo/types/router.d.ts) can go stale while the dev server runs on Windows:
  new non-route files under src/ show up as routes like `/../lib/api` and tsc rejects real hrefs.
  Fix: stop the server, delete .expo/types, restart `npx expo start`.
- After installing packages, restart Metro (`npx expo start --clear`) or web SSR fails with
  "Requiring unknown module".
- Sign-in lives at src/app/(auth)/sign-in.tsx with NO (auth)/_layout.tsx, on purpose: with a group
  layout, Stack.Protected redirects signed-out users to `/(auth)`, which is an unmatched route.
- Charts use react-native-gifted-charts (+ react-native-svg, expo-linear-gradient). It deep-clones
  chart data, so never put StyleSheet styles inside data items (frozen → crash); use fresh plain
  objects. LineChart x-label box width is `spacing + labelsExtraHeight` (the prop is misnamed).
- Screens fetch with `useAsync(load, key)` (src/hooks/use-async.ts): refetches on focus and when
  `key` changes. Responsive sizes come from `useLayout()` (src/hooks/use-layout.ts).
