# Income / Expenses (รายรับรายจ่าย)

Personal income/expense tracker. The owner writes in Thai; the UI is Thai and answers should be in Thai.
See README.md for features, API table and run commands.

## Stack and layout

- `backend/` — Go 1.25, standard `net/http` (Go 1.22+ method routing), SQLite via `modernc.org/sqlite` (pure Go, no CGO). Runs in Docker.
  - `cmd/api/main.go` wiring only: config → DB → `server.New` → HTTP server, backups, recurring, graceful shutdown
  - `internal/` leaf packages (import no app package, or only `logx`/`money`): `config` (env) · `database` (schema/seed/migrations)
    · `httpx` (JSON helpers, `PathID`, CORS, request log) · `money` (satang) · `ocr` (Tesseract + slip/receipt parsers)
    · `split` (trip maths) · `mail` · `backup` · `web` (serves the exported app) · `logx` (logger)
    · `images` (slips folder: `Path`/`Remove`, signed links `Link`/`Valid`, one signature kind per picture type)
  - Domain packages (handlers + `Register(mux)`): `internal/auth` users, sessions, PIN, passwords, forgot, Google —
    exports `RequireUnlocked`, `UserID(r)`, `ResetPassword` · `internal/trip` trip bill splitting (`Register(mux, guard)`)
  - `internal/server` — wires auth + trip (`server.go`) and holds the ledger, which is too coupled to split:
    `handlers.go` transactions/months/yearly/payees · `accounts.go` · `slips.go` · `transfers.go` · budgets/recurring/debts/…
    (`server_test.go`: migration from the pre-auth DB, per-user isolation; its `newTestServer` runs the whole API)
  - `internal/apitest` — shared test client (`Do`, `DoInto`, `SignedIn`) and `OpenDB`; each package's tests build their own mux.
  - Keep the direction: leaves never import domain packages; `auth`/`trip` never import `server` or each other except
    `trip` → `auth.UserID`. New pure logic goes in a leaf package with its own tests.
- `frontend/` — Expo SDK 58 + Expo Router (`src/app/`), React Native, TypeScript, runs on web/Android/iOS.
  - `(tabs)/index.tsx` monthly · `(tabs)/yearly.tsx` chart · `(tabs)/accounts.tsx` · `transaction.tsx` add/edit/confirm-slip form · `account.tsx` account form
  - `(tabs)/settings.tsx` lock / change PIN / sign out · `change-pin.tsx`
  - `src/api.ts` all API calls + types · `src/format.ts` money/date/Thai month helpers, colors · `src/state.ts` tiny cross-screen hand-off
  - `src/auth.tsx` AuthProvider (sign-in state, idle lock) · `components/AuthScreens.tsx` sign-in / PIN screens · `components/PinPad.tsx` · `src/tokenStore(.web).ts`
  - Follow `frontend/AGENTS.md` (Expo rules: `npx expo install`, versioned docs).
- `docker-compose.yml` — API **and the built web app** on 127.0.0.1:8080 only; other devices use HTTPS via
  `tailscale serve --bg 8080` → https://aekkaroek.tail1a3ff3.ts.net (tailnet only) (build context = repo root; `backend/Dockerfile` runs
  `expo export` in a node stage, Go serves it from `WEB_DIR` via `internal/web`). Data in volume
  `income_expenses_income_expenses_data` (`/app/data`: DB + `slips/` images). Frontend changes reach the live site only after a rebuild.
- The web build calls the API on its own origin; only the dev server (`__DEV__`, port 8081) calls `<host>:8080`.
- Don't start `expo start` with `CI=1` when the owner should see live edits — CI mode disables reloads.

## Commands

```bash
docker compose up -d --build                                                   # backend (Go is not installed locally)
docker run --rm -v "$PWD/backend:/src" -w /src golang:1.25-alpine sh -c "gofmt -l -w . && go vet ./... && go test ./..."
cd frontend && npx tsc --noEmit                                                # typecheck
cd frontend && npm test                                                        # trip-split helpers (node --test)
cd frontend && npx eslint src                                                  # lint (0 errors expected; set-state-in-effect is a known warning)
cd frontend && npx expo start --web --port 8081                                # web UI (also in .claude/launch.json)
```

## Domain rules

- Money is stored as integer **satang** (`amount_satang`); the API speaks baht floats. Convert with `toSatang`/`fromSatang`.
- Categories: รับ(+1) จ่าย(−1) ให้ยืม(−1) กู้(+1) รับคืนเงินยืม(+1) คืนเงินกู้(−1) — `direction` decides the sign.
  Debts (`debts.go`) are derived per payee from the last four; there is no debts table. Subcategories ("รายการ") belong to one category.
- Transfers (`transfers` table, `transfers.go`) move money between a user's own accounts: they change both account
  balances, cancel out in the all-accounts total, and are never part of in/out totals.
- Balance = sum of account opening balances + signed transactions (+ transfers for a single account). Transactions saved before accounts existed have `account_id NULL` ("ไม่ระบุบัญชี") and still count in the total.
- New/edited transactions **require** an account; payee ("ผู้รับ") and subcategory are optional.
- Bank slips: OCR is **local Tesseract** (owner's choice — do not send slips to external services). A slip is stored in `slips` as `pending` (not in any balance) and becomes a transaction only when confirmed (`POST /api/transactions` with `slip_id`), or a transfer (`POST /api/transfers` with `slip_id` → `slips.transfer_id`). Deleting that transaction/transfer deletes the slip + image.
- OCR runs twice (original + ImageMagick 2x); `slips.ocr_text` holds both, split by `ocr.UpscaledMark`. Always parse
  stored text with `ocr.ParseSlipText` (merges field by field), never `parseSlip` directly.
- Trip bill splitting (`internal/trip/trip.go`, screens `(tabs)/trips.tsx`, `trip.tsx`, `trip-bill.tsx`, `trip-payment.tsx`): members are
  names, not users; all maths is in package `internal/split` (int64 satang, leftover satang to the payer if sharing else
  the first listed; pairwise netting and greedy "minimal" transfers). Balances are never stored — always computed from
  `trip_bills`/`trip_bill_parts` minus `trip_payments`. Payment slips and bill photos (`trip_bills.image_file`) live in
  the slips dir as `trip-*` files (backed up); each kind has its own link signature (`tripImage` in trip.go).
  `trip/ocr.go` (parser: `internal/ocr/receipt.go`) reads a receipt (items + total) or slip for the form only — it never stores or auto-saves anything.
  `frontend/src/tripSplit.ts` mirrors the share rule for the form preview (`npm test` runs its tests with Node).
  Shared pool ("กองกลาง"): a `trip_members` row with `is_pool = 1` (one per trip) that can pay bills and send/receive
  payments but never shares a bill, so the usual balances say who tops it up or gets money back. Members and the pool
  carry payment details (`promptpay`, bank fields, `qr_file` picture, signed like other trip images);
  `frontend/src/promptpay.ts` builds the PromptPay QR payload with the amount (`components/PayInfo.tsx` draws it).
- The "รายรับรายจ่าย" tab is `index` (month) + hidden `yearly` route, switched by `PeriodSwitch`; the tab bar takes
  glyphs + aliases (`makeSpotlightTabBar`).
- Slip rules (`slip_rules.go`, screen `slip-rules.tsx`): per-user, checked in `sort_order`, first match → `slip.suggestion` that only **prefills** the confirm form; never auto-confirm. `self` = sender and receiver are the same person (`samePerson`).
- Deleting an account with transactions is refused (409).
- Multi-user: `accounts`, `transactions`, `slips`, `transfers`, `subcategories` carry `user_id`; **every query must filter by `userID(r)`** (= `auth.UserID(r)`).
  Categories, banks and account types are shared. New users get `starterSubcategories`.
- Table rebuilds: build `<table>_new`, copy, drop old, rename new (never rename the old table — SQLite repoints
  other tables' REFERENCES at it). See `upgradeSubcategories`.
  Data routes go through `requireUnlocked` (session + PIN unlocked within 5 min). The first user to sign up takes over rows with `user_id NULL`.
- Sign-in methods live in `identities` (`provider`, `subject`) so Google sign-in can be added later without touching `users`.
- Slip images are served via signed short-lived links (`image_url`), not the session token.
- Forgot password (`auth/forgot.go`, `mail.go`): e-mail OTP (3 min, single use, 5 tries, 60 s resend, 5/hour) →
  temporary password (24 h) → that session is `must_change_password` until a new one is set. Answers never
  reveal whether an e-mail has an account. SMTP comes from `.env`; tests use `mailbox` (forgot_test.go).
- Never commit real slip text, names, account numbers or refs as test fixtures — anonymise them.

## Branches

- **`dev`** — day-to-day work: commit and push here.
- **`main`** — the stable system. The live container on this PC must run `main`.
- After every finished change whose checks pass (tsc/lint/tests): merge `dev` → `main` (fast-forward) and deploy
  from `main` straight away, without waiting to be asked (owner's rule since 2026-11-08; they test on the phone):
  `git checkout main` → `git merge --ff-only dev` → push → `docker compose up -d --build` → `git checkout dev`.
  Schema changes: back up the live DB first and test on a copy (another port, e.g. :8090) before deploying.
  Never deploy the live container from `dev`.

## Working on the owner's data

- The Docker volume holds the owner's **real** data. Back up before schema changes:
  `docker compose stop && docker cp income-expenses-api:/app/data/income_expenses.db backups/<name>.db && docker compose start`
  (then move it to `manual/` in the backup folder set by `BACKUP_HOST_DIR` in `.env`, which syncs to the cloud).
  Daily copies + `monthly/` + `slips/` are written there automatically; use one of them as the test copy.
- Schema changes go through `migrate()` / `addColumnIfMissing` in `internal/database` (existing DBs must upgrade in place).
- Remove any test rows you create; never commit `backups/` or `*.db` (already in `.gitignore`).
- Never sign up a test user on the live DB — it needs a real account to log in, and on a fresh DB the first sign-up takes over all data.
  Test against a copy (run the image on another port with a copied `/app/data`).

## Gotchas (Windows dev machine)

- Git Bash mangles Thai in curl command-line args — send JSON bodies from a UTF-8 file (`--data-binary @file`).
- Files may have CRLF line endings; prefer the Edit tool over `sed`/string replace for multi-line edits.
- Node is managed by nvm-windows; this project uses Node 22 (`nvm use 22.23.4`). `nvm use` switches it machine-wide.
- Animated values: `useState(() => new Animated.Value(0))[0]`, not `useRef(...).current` (react-hooks/refs lint rule).
- Theme: `COLORS` (format.ts) is the light or dark palette picked once at startup (`themeStore(.web).ts`); never
  hard-code backgrounds — use `COLORS.card/input/subtle/track/dangerSoft/skeleton`. Changing theme reloads (web).
- `Alert.alert` is a no-op on react-native-web — use `confirmAsync` / `showInfo` / `showError` from `format.ts`.
