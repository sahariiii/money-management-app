@AGENTS.md

## Project
AI money agent app. Users upload bank statements and receipts; the app builds one ledger,
shows spending, budgets, bill alerts, a credit-card rewards optimizer, and an AI chat
assistant that remembers spending habits. Later the backend will be FastAPI (Python),
Clerk for auth, SurrealDB for the ledger, SurrealDB Agent Memory for long-term memory.

Current phase: the UI talks to the Python backend in backend/ (FastAPI over the file library the
Streamlit pipeline writes). No real auth or database yet. Transactions, cards (one dummy card) and
statements come from the backend; budgets, bills, alerts, card rewards and chat aren't in the
backend yet, so they are empty with it and exist only in mock mode.

## Rules
- Expo + Expo Router + TypeScript. Must run on Android (Expo Go) AND web.
- Install Expo packages with `npx expo install`, never plain `npm install`, so versions match the SDK.
- Styling: plain StyleSheet using tokens from src/constants/theme.ts. No hardcoded colors or spacing in screens.
- All data access goes through src/lib/api.ts. With EXPO_PUBLIC_API_URL set (.env.local) it calls the
  backend; without it, it serves mock data from src/data/mock.ts. Screens never import mock data directly.
- Backend Python uses uv (`uv add`, `uv run`), never pip.
- Every screen must work at phone width and on a wide desktop browser (content max width ~900px, centered).
- Never store or display full card numbers: last 4 digits only.
- After each change, run `npx tsc --noEmit` and fix all errors.

## Layout
This project uses the `src/` layout (import alias `@/*` -> `src/*`):
- src/app/ — routes only (Expo Router). `(auth)/sign-in`, `(tabs)/` with 5 tabs
  (index, transactions, chat, cards, more), modals: upload-statement, scan-receipt, transaction/[id].
- src/components/ — shared UI (Screen, Card, StatTile, ProgressBar, TransactionRow, AlertBanner,
  Chip, SectionHeader, EmptyState). Import from `@/components`.
- src/constants/theme.ts — design tokens (colors, spacing, radius, fontSize, layout).
- src/types.ts — domain types mirroring the future DB, plus API response shapes and CATEGORIES.
- src/lib/api.ts — the only data layer. Backend mode: fetch with a bearer token; `today()` is the
  real date. Mock mode: fake delay, in-memory copy of mock data (recategorize/dismiss persist per
  session), `today()` is the demo date. Either way summaries and budgets are computed here from
  transactions, never hardcoded.
- src/data/mock.ts — seeded, deterministic Aug 1 – Oct 22 2026 Canadian data. Demo "today"
  is 2026-10-23. Planned demo moments: groceries mostly on debit, Rogers $65 → $200 in Oct,
  messy raw descriptions, Food budget ~85% in Oct, biweekly payroll.
- backend/personal_banker/api.py — FastAPI app for the Expo app. Run from backend/:
  `uv run uvicorn personal_banker.api:app --host 0.0.0.0 --port 8000`. Models mirror src/types.ts.
- backend/personal_banker/ledger.py — budget.json rows as app transactions. Rows keep workbook
  categories (Streamlit and the workbook export need them); EXPENSE_CATEGORIES maps them onto the
  app's CATEGORIES. App edits go in a row's `app_category`, "always" rules in library/merchant_rules.json.
  Refunds (negative expenses) become isIncome: true, since app amounts are always positive.
- backend/personal_banker/service.py — statement processing (extract pages, then categorize),
  shared by the API's background jobs and the Streamlit document viewer.

## Gotchas
- PERSONAL_BANKER_API_TOKEN in backend/.env must equal EXPO_PUBLIC_API_TOKEN in .env.local.
  Restart `npx expo start` after creating .env.local; a running server doesn't pick up a new file.
- On a phone, api.ts swaps localhost in EXPO_PUBLIC_API_URL for Metro's host (from
  Constants.expoConfig.hostUri). Windows Firewall must allow inbound port 8000.
- `uv add` and `uv sync` without `--extra paddle` uninstall PaddleOCR-VL. Run `uv sync --extra paddle` after.
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
