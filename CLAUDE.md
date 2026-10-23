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
  (index, transactions, chat, cards, more), modals: upload-statement, scan-receipt, transaction/[id].
- src/components/ — shared UI (Screen, Card, StatTile, ProgressBar, TransactionRow, AlertBanner,
  Chip, SectionHeader, EmptyState). Import from `@/components`.
- src/constants/theme.ts — design tokens (colors, spacing, radius, fontSize, layout).
- src/lib/api.ts, src/data/mock.ts — data access layer and mock data (to be added).
