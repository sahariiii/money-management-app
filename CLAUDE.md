@AGENTS.md

## Project
AI money agent app. Users upload bank statements and receipts; the app builds one ledger,
shows spending, budgets, bill alerts, a credit-card rewards optimizer, and an AI chat
assistant that remembers spending habits. Later the backend will be FastAPI (Python),
Clerk for auth, SurrealDB for the ledger, SurrealDB Agent Memory for long-term memory.

Current phase: UI + real auth (Clerk) + the Python backend in backend/ (FastAPI; each user's
records go through a DataStore, JSON files for now, so SurrealDB can replace it without touching callers). Transactions, cards with their reward
rules (add, edit, delete), statement upload, receipt scanning, budgets, the savings goal and the
assistant chat come from the backend; bills and alerts aren't in the backend yet, so with it they
start empty (additions last until reload) and the full demo exists only in mock mode.

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
  scan-receipt, transaction/[id], add-card, edit-card/[id], savings-goal, chat-history. New modal routes must also be registered in
  src/app/_layout.tsx, inside the signed-in `Stack.Protected` group.
- Mocked "AI" features live in api.ts (mock mode): chat answers (on-track, restaurants, which card),
  uploadStatement (always 40 latest rows, all already in ledger), scanReceipt (always matches
  the Gusto 101 transaction). With the backend, uploadStatement really uploads and waits for the
  backend to finish, scanReceipt sends the photo to POST /api/receipts/scan (Claude vision via
  backend/personal_banker/receipts.py), and chat goes to POST /api/chats. Pickers
  (expo-document-picker / expo-image-picker) are real.
- backend/personal_banker/assistant.py — the assistant: Claude (tool runner) with read-only tools over
  ledger.transactions/cards (list_cards, spending_summary, find_transactions, budgets_and_goal) plus
  show_headline, which sets the reply's `summary` card. Conversations (ChatThread), like Claude's and
  ChatGPT's history: ChatRecords in the user's DataStore (DataStore.chats; JSON: chats/<chat_hex>.json)
  with a title Claude sets on the first question (name_conversation, always in the tool list so the
  cache holds; the context says when the conversation is new), else the question shortened. GET
  /api/chats, GET/PATCH/DELETE /api/chats/{id}, POST /api/chats (first question; nothing is saved if it
  fails), POST /api/chats/{id}/messages. An older single chat.json (the user's, or the pre-per-user
  library's via migrate.py) becomes one conversation (assistant.legacy_conversation).
  Assistant tab: the list beside the chat on wide screens (ChatHistoryList), the `chat-history` modal
  on phones, which returns via router.dismissTo('/chat', { thread, at }). Mock mode seeds two chats.
  Earlier turns of the same conversation go back to Claude as plain text, without their tool calls.
  Long-term memory has an interface (backend/personal_banker/memory.py: MemoryStore, JsonMemoryStore via
  Storage.memory) but the assistant doesn't use it yet.
  It doesn't know bills (not in the backend). Replies are plain text (no Markdown): the chat bubble is a plain Text.
  Cashback questions go through its `cashback` tool (backend/personal_banker/rewards.py): what the
  statements print is the answer; only spending no printed statement covers gets an estimate (same
  logic as rewardFor in api.ts, keep them in step), which the assistant must label and caveat.
- src/components/ — shared UI (Screen, Card, StatTile, ProgressBar, TransactionRow, AlertBanner,
  Chip, SectionHeader, EmptyState, AuthScreen, CodeForm, Avatar, CardForm: the add/edit card form,
  GoalCard: the savings goal's progress, on More and, once set, Home, ChatHistoryList: past
  conversations grouped Today / Yesterday / Previous 7 and 30 days / by month, with rename and
  delete). Import from `@/components`.
- src/constants/theme.ts — design tokens (colors, spacing, radius, fontSize, layout).
- src/types.ts — domain types mirroring the future DB, plus API response shapes and CATEGORIES.
  "Gas & EV charging" is its own category (workbook "Gas"), apart from Transport (transit, taxis,
  rideshare), because cards like CIBC's pay different rates on them. "Car" is the user's car:
  insurance, financing/lease, maintenance, parking (workbook "Car payment", "Car maintenance"), plus
  rows the backend's CAR_TEXT pattern (ledger.py) spots in other workbook categories, e.g. parking.
  "Fees & interest" (workbook "Bank") earns no cashback.
- Rewards math (api.ts): fees and interest, housing and income earn nothing (NOT_CARD_PAYABLE);
  refunds take back cashback at the rate the purchase earned, as issuers do. The Cards tab shows each
  card's latest statement (getStatementRewards): the amount is the statement's own printed rewards
  summary (Statement.rewards), with the app's estimate per rate beside it (that statement's own
  transactions, via Transaction.statementId). No printed summary: the estimate is the amount.
- Statement rewards: categorizing saves "period" and "rewards" (lines as printed, this statement only)
  in budget.json and on the StatementRecord. Statements categorized before that get them at API startup
  (_read_summary, one Claude call over the saved transcription; bank-account statements are skipped).
- Savings goal (one per user): name, amount, startDate (the day it was set), targetDate. Saved is
  money in minus money out from startDate through the latest transaction (`asOf`: statements arrive
  late), against a straight-line pace to the target date (goalStatus in api.ts, goal_progress in
  backend/personal_banker/planning.py; keep them in step). The savings-goal modal suggests monthly
  budgets with planSavings (src/lib/savings-plan.ts) from getSpendingBaseline (averages over the last
  3 complete months, refunds netted): discretionary categories are cut first (up to 50%), then
  everyday needs (up to 15%); fixed costs (housing, car, phone, utilities, fees) never. Saving the
  goal replaces every budget at once (PUT /api/goal), keeping budgets for categories the plan doesn't
  list. Budgets and the goal are in the user's DataStore (planning.py; GET/PUT /api/budgets/{category},
  GET/PUT/DELETE /api/goal).
- src/lib/card-presets.ts — known cards (CARD_PRESETS) with their published cashback; the card form's
  "Known cards" chips fill in everything but the card's own numbers. The mock Visa uses the CIBC one.
- src/lib/api.ts — the only data layer. `USE_MOCK` is true when EXPO_PUBLIC_API_URL is unset.
  Backend mode: `apiFetch()` with the Clerk session token; `today()` is the real date. Mock mode:
  fake delay, in-memory copy of mock data (edits persist per session), `today()` is the demo date.
  Either way summaries, budget and goal progress and the optimizer are computed here from transactions.
- src/lib/auth.ts — Clerk helpers for the auth screens: readable error messages, the
  `navigate` callback for finalize()/setActive().
- src/data/mock.ts — seeded, deterministic Aug 1 – Oct 22 2026 Canadian data. Demo "today"
  is 2026-10-23. Planned demo moments: groceries mostly on debit, Rogers $65 → $200 in Oct,
  messy raw descriptions, Food budget ~85% in Oct, biweekly payroll.
- backend/personal_banker/api.py — FastAPI app for the Expo app. Run from backend/:
  `uv run uvicorn personal_banker.api:app --host 0.0.0.0 --port 8000`. Models mirror src/types.ts.
  Every /api route takes the caller's DataStore (`store: Store`, from the verified user id); never
  reach storage any other way. Statement processing runs in one background worker, but each
  statement's status (queued/running/stopped/done, stage, message) is saved on its StatementRecord,
  and startup resumes queued/running ones for every user.
- backend/personal_banker/datastore.py — `DataStore` (Protocol: one user's statements, transactions,
  cards + reward rules, merchant rules, budgets + goal, receipt scans, chat) and `JsonDataStore`, which
  keeps them as JSON under library/users/<Clerk user id>/ (layout in its docstring). `Storage` opens a
  user's store (`store(user_id)`, `memory(user_id)`, `user_ids()`). All read-change-write file logic
  lives here; ledger.py/planning.py/assistant.py only call record methods. A SurrealDB store implements
  the same Protocol. backend/personal_banker/records.py holds the stored record models (and the shared
  app models: categories, Card, Budget, ChatMessage, re-exported from ledger/planning/assistant).
  backend/personal_banker/store.py `Library` is just one user's statement files (DataStore.files):
  PDF, page images, transcriptions, and the categorizer's budget.json.
- backend/personal_banker/ledger.py — the user's transactions as the app sees them. import_statement
  stores a statement's budget.json rows as TransactionRecords with ids that never change (`tx_<hex>`;
  rows migrated from before keep their old `<doc>-e003` ids as plain strings — never parse an id).
  Each gets a dedup_key (account last4 + date + direction + amount + description as printed + which
  occurrence on its statement); a row an earlier statement already brought is stored with duplicate_of
  and left out, so overlapping statements count once (Statement.duplicateCount). Re-importing (e.g.
  after Streamlit edits) matches rows by dedup_key, keeping ids and app-picked categories.
  Rows keep workbook categories (workbook_category); EXPENSE_CATEGORIES maps expense rows onto
  the app's EXPENSE_CATEGORIES, INCOME_CATEGORY_MAP income rows onto INCOME_CATEGORIES (Work, Tax refund,
  Side income, Reimbursement, Other income; workbook "Job…" = Work), stored as auto_category. There is no
  single "Income" category: check `isIncome` for direction, `isIncomeCategory()` for the kind of category.
  Refunds (negative expenses) become isIncome: true with a spending category, since app amounts are
  always positive. Shown category = user_category (picked in the app) > merchant rule ("always") > auto_category.
  Refunds are never income: link_refunds (ledger.py, run on every read) links each one to the purchase
  it returns (same merchant ignoring case/punctuation, on or before it, within RETURN_DAYS = 120, with
  enough not yet returned; a whole return, then the same card, then the latest wins), setting
  `refundOf` on the refund and `refundedAmount`/`refundIds` on the purchase. Spending everywhere
  (summaries, budgets, weekly, the plan baseline, the assistant) uses netSpending (src/lib/refunds.ts,
  net_spending in ledger.py): a purchase less what came back; a refund with no purchase found comes off
  spending on its own date; income counts income categories only. Activity shows a refund in grey
  ("Return of Oct 11 purchase") and a fully returned purchase struck through. The categorizer is told
  that money in from a merchant is a refund (negative expense) named like the purchase's vendor.
  The mock seeds two returns (Winners, whole; Canadian Tire, partly) with the links set in mock.ts.
  A statement's transactions go on the card whose `account_last4` equals the statement's
  (StatementRecord.account.last4, from the categorizer), worked out on every read, so editing a card
  re-links at once. Unmatched statements' transactions go on DUMMY_CARD ("Unmatched statements",
  isPlaceholder: true, not editable), listed while any exist; the Activity tab warns about them
  (Statement.cardMatch). Statements whose account isn't read yet are "pending" until the API's startup
  backfill reads it from their transcription.
  Expenses added from receipts ("Add as expense") are TransactionRecords with source "receipt" (ids
  `receipt_<hex>`, cardId a card or CASH_CARD_ID "cash"; only these can be deleted). find_match
  links a receipt to an expense with the same amount within MATCH_DAYS, on the card whose `last4`
  is printed on the receipt (or the placeholder). A receipt expense is hidden once a statement brings
  the same purchase, and that transaction takes its category unless the user picked one.
  Every scan is saved (ScanRecord + photo: what was read, transaction_id).
  It gets a transaction when added as an expense (ExpenseInput.receipt_id) or attached to its match
  (POST /api/receipts/{id}/attach); unsaved scans are deleted after a day. Transaction.receiptId comes
  from that link (or from the receipt expense a statement row replaced); GET /api/receipts/{id} returns
  the details with the photo as a data: URL (the app can't send auth headers for an image).
- backend/personal_banker/migrate.py — copies the pre-per-user library (statement folders and
  cards.json etc. at the top of library/) to one user: `uv run python -m personal_banker.migrate --user
  <Clerk user id>`. Until run, nobody sees that data; the server logs the command with the signed-in
  user's id. It writes library/.migrated and leaves the old files in place.
- backend/tests — `uv run pytest` (from backend/). test_snapshot.py proves migration changes no API
  response: fixtures/legacy_expected.json was captured from the code before per-user records, over the
  made-up fixtures/legacy_library; snapshots/real_library.json (git-ignored: real data) does the same for
  backend/library. A deliberately new response field goes in ADDED_FIELDS there.
- On native, uploads (statements, receipts) must append an expo-file-system `File`, not React Native's
  `{ uri, name, type }`: SDK 58's expo/fetch replaces global fetch and rejects those parts. See appendFile in api.ts.
- backend/personal_banker/service.py — statement processing (extract pages, categorize, import into
  the ledger), shared by the API's background jobs and the Streamlit document viewer. The budget
  workbook (PERSONAL_BANKER_WORKBOOK) is optional: without it, the categorizer uses the app's own
  categories (app_budget_setup), with the user's ledger so far as examples.

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
  CLERK_PUBLISHABLE_KEY env var overrides it) and takes the user from it: every request only sees that
  user's DataStore. PERSONAL_BANKER_API_TOKEN callers are PERSONAL_BANKER_API_TOKEN_USER (or "api-token");
  with no key and no token set, everyone is "anyone".

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
- Streamlit (`uv run streamlit run streamlit_app.py`) and the CLIs work as one user:
  PERSONAL_BANKER_LOCAL_USER, or the only user with data. Saving categories there re-imports the
  statement into that user's ledger.
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
