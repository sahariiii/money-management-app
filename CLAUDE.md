@AGENTS.md

## Project
AI money agent app. Users upload bank statements and receipts; the app builds one ledger,
shows spending, budgets, bill alerts, a credit-card rewards optimizer, and an AI chat
assistant that remembers spending habits. Later the backend will be FastAPI (Python),
Clerk for auth, SurrealDB for the ledger, SurrealDB Agent Memory for long-term memory.

Current phase: UI + real auth (Clerk) + the Python backend in backend/ (FastAPI over the file
library the Streamlit pipeline writes; no database yet). Transactions, cards with their reward
rules (add, edit, delete), statement upload and receipt scanning come from the backend; budgets,
bills, alerts and chat aren't in the backend yet, so with it they start empty (additions last until
reload) and the full demo exists only in mock mode.

## Rules
- Expo + Expo Router + TypeScript. Must run on Android (Expo Go) AND web.
- Install Expo packages with `npx expo install`, never plain `npm install`, so versions match the SDK.
- Styling: plain StyleSheet using tokens from src/constants/theme.ts. No hardcoded colors or spacing in screens.
- One env file for the whole project: `.env` in the repo root (git-ignored), read by Expo and by the
  backend (personal_banker/__init__.py loads it). `.env.example` lists every variable; keep it in sync
  when adding one. No backend/.env or .env.local. Only `EXPO_PUBLIC_*` vars reach the app bundle, so
  backend secrets must never get that prefix.
- All data access goes through src/lib/api.ts. With EXPO_PUBLIC_API_URL set (.env) it calls the
  backend; without it, it serves mock data from src/data/mock.ts. Screens never import mock data directly.
- Backend Python uses uv (`uv add`, `uv run`), never pip.
- Every screen must work at phone width and on a wide desktop browser (content max width ~900px, centered).
- Never store or display full card or account numbers: last 4 digits only (`last4`, `accountLast4`).
- After each change, run `npx tsc --noEmit` and fix all errors.

## Layout
This project uses the `src/` layout (import alias `@/*` -> `src/*`):
- src/app/ — routes only (Expo Router). `(auth)/sign-in`, `(auth)/sign-up`, `sso-callback`,
  `(tabs)/` with 5 tabs (index, transactions, chat, cards, more), modals: upload-statement,
  scan-receipt, transaction/[id], add-card, edit-card/[id]. New modal routes must also be registered in
  src/app/_layout.tsx, inside the signed-in `Stack.Protected` group.
- Mocked "AI" features live in api.ts (mock mode): chat answers (on-track, restaurants, which card),
  uploadStatement (always 40 latest rows, all already in ledger), scanReceipt (always matches
  the Gusto 101 transaction). With the backend, uploadStatement really uploads and waits for the
  backend to finish, scanReceipt sends the photo to POST /api/receipts/scan (Claude vision via
  backend/personal_banker/receipts.py), and chat replies "not connected". Pickers
  (expo-document-picker / expo-image-picker) are real.
- src/components/ — shared UI (Screen, Card, StatTile, ProgressBar, TransactionRow, AlertBanner,
  Chip, SectionHeader, EmptyState, AuthScreen, CodeForm, Avatar, CardForm: the add/edit card form).
  Import from `@/components`.
- src/constants/theme.ts — design tokens (colors, spacing, radius, fontSize, layout).
- src/types.ts — domain types mirroring the future DB, plus API response shapes and CATEGORIES.
- src/lib/api.ts — the only data layer. `USE_MOCK` is true when EXPO_PUBLIC_API_URL is unset.
  Backend mode: `apiFetch()` with the Clerk session token; `today()` is the real date. Mock mode:
  fake delay, in-memory copy of mock data (edits persist per session), `today()` is the demo date.
  Either way summaries, budgets and the optimizer are computed here from transactions.
- src/lib/auth.ts — Clerk helpers for the auth screens: readable error messages, the
  `navigate` callback for finalize()/setActive().
- src/data/mock.ts — seeded, deterministic Aug 1 – Oct 22 2026 Canadian data. Demo "today"
  is 2026-10-23. Planned demo moments: groceries mostly on debit, Rogers $65 → $200 in Oct,
  messy raw descriptions, Food budget ~85% in Oct, biweekly payroll.
- backend/personal_banker/api.py — FastAPI app for the Expo app. Run from backend/:
  `uv run uvicorn personal_banker.api:app --host 0.0.0.0 --port 8000`. Models mirror src/types.ts.
- backend/personal_banker/ledger.py — budget.json rows as app transactions. Rows keep workbook
  categories (Streamlit and the workbook export need them); EXPENSE_CATEGORIES maps them onto the
  app's CATEGORIES. App edits go in a row's `app_category`, "always" rules in library/merchant_rules.json.
  Refunds (negative expenses) become isIncome: true, since app amounts are always positive.
  Cards and reward rules live in library/cards.json. A statement's transactions go on the card whose
  `account_last4` equals the statement's (budget.json "account".last4, from the categorizer), worked
  out on every read, so editing a card re-links at once. Unmatched statements' transactions go on
  DUMMY_CARD ("Unmatched statements", isPlaceholder: true, not editable), listed while any exist; the
  Activity tab warns about them (Statement.cardMatch). Statements categorized before "account" existed
  are "pending" until the API's startup backfill reads it from their transcription.
  Expenses added from receipts ("Add as expense") live in library/receipts.json (ids `receipt_<hex>`,
  source: "receipt", cardId a card or CASH_CARD_ID "cash"; only these can be deleted). find_match
  links a receipt to an expense with the same amount within MATCH_DAYS, on the card whose `last4`
  is printed on the receipt (or the placeholder). A receipt expense is hidden once a statement brings
  the same purchase, and that transaction takes its category unless the user picked one.
  Every scan is saved in library/receipts/ (`scan_<hex>`.jpg + .json: what was read, transaction_id).
  It gets a transaction when added as an expense (ExpenseInput.receipt_id) or attached to its match
  (POST /api/receipts/{id}/attach); unsaved scans are deleted after a day. Transaction.receiptId comes
  from that link (or from the receipt expense a statement row replaced); GET /api/receipts/{id} returns
  the details with the photo as a data: URL (the app can't send auth headers for an image).
- On native, uploads (statements, receipts) must append an expo-file-system `File`, not React Native's
  `{ uri, name, type }`: SDK 58's expo/fetch replaces global fetch and rejects those parts. See appendFile in api.ts.
- backend/personal_banker/service.py — statement processing (extract pages, then categorize),
  shared by the API's background jobs and the Streamlit document viewer.

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
- Backend calls: `apiFetch()` in api.ts sends `Authorization: Bearer <Clerk session token>`
  (`getAuthToken()` via `getClerkInstance()`). Never send a user ID: the backend verifies the token
  (backend/personal_banker/auth.py, using the same EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY from .env; a
  CLERK_PUBLISHABLE_KEY env var overrides it) and takes the user from it.

## Gotchas
- Clerk dashboard settings matter (instance logical-sole-3210, dev): phone number and username are
  off, email verification at sign-up is off, first/last name are on. Turning a requirement back on
  makes sign-up end in a "missing fields" message. Passwords need 15+ characters on this instance.
  Google in Expo Go only creates a session if the redirect URL (`exp://<LAN-IP>:8081/--/sso-callback`,
  logged in the Metro console in dev) is allowlisted under Native applications.
- The backend accepts the app's requests only if it sees EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY (root .env).
  PERSONAL_BANKER_API_TOKEN there is an optional static token for curl and scripts. Restart both
  `npx expo start` and uvicorn after editing .env; running servers don't pick up changes.
- On a phone, api.ts swaps localhost in EXPO_PUBLIC_API_URL for Metro's host (from
  Constants.expoConfig.hostUri). Windows Firewall must allow inbound port 8000.
- Statement extraction uses Claude by default; PERSONAL_BANKER_EXTRACTION_ENGINE=paddleocr-vl in .env switches
  to the local (much slower) PaddleOCR-VL. Results are stored per engine; budget.json isn't.
- `uv add` and `uv sync` without `--extra paddle` uninstall PaddleOCR-VL. Run `uv sync --extra paddle` after
  (only matters if you use that engine).
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
