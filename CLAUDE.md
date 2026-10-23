@AGENTS.md

## Project
AI money agent app. Users upload bank statements and receipts; the app builds one ledger,
shows spending, budgets, bill alerts, a credit-card rewards optimizer, and an AI chat
assistant that remembers spending habits. Later the backend will be FastAPI (Python),
Clerk for auth, SurrealDB for the ledger, SurrealDB Agent Memory for long-term memory.

Current phase: UI only. No backend, no real auth, no database. Everything uses mock data.

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
- src/app/ — routes only (Expo Router). `(auth)/sign-in`, `(tabs)/` with 5 tabs
  (index, transactions, chat, cards, more), modals: upload-statement, scan-receipt,
  transaction/[id], add-card. New modal routes must also be registered in src/app/_layout.tsx.
- Mocked "AI" features live in api.ts: chat answers (on-track, restaurants, which card),
  uploadStatement (always 40 latest rows, all already in ledger), scanReceipt (always matches
  the Gusto 101 transaction). Pickers (expo-document-picker / expo-image-picker) are real.
- src/components/ — shared UI (Screen, Card, StatTile, ProgressBar, TransactionRow, AlertBanner,
  Chip, SectionHeader, EmptyState). Import from `@/components`.
- src/constants/theme.ts — design tokens (colors, spacing, radius, fontSize, layout).
- src/types.ts — domain types mirroring the future DB, plus API response shapes and CATEGORIES.
- src/lib/api.ts — the only data layer. Async, fake delay, in-memory copy of mock data
  (recategorize/dismiss persist per session). Summaries, budgets, optimizer and chat answers
  are computed from transactions, never hardcoded. `today()` returns the demo date.
- src/data/mock.ts — seeded, deterministic Aug 1 – Oct 22 2026 Canadian data. Demo "today"
  is 2026-10-23. Planned demo moments: groceries mostly on debit, Rogers $65 → $200 in Oct,
  messy raw descriptions, Food budget ~85% in Oct, biweekly payroll.

## Gotchas
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
