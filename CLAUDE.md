# Income / Expenses (รายรับรายจ่าย)

Personal income/expense tracker. The owner writes in Thai; the UI is Thai and answers should be in Thai.
See README.md for features, API table and run commands.

## Stack and layout

- `backend/` — Go 1.25, standard `net/http` (Go 1.22+ method routing), SQLite via `modernc.org/sqlite` (pure Go, no CGO). Runs in Docker.
  - `main.go` server + graceful shutdown · `db.go` schema/seed/migrations · `handlers.go` transactions, months, yearly, payees
  - `accounts.go` accounts/banks/types · `slips.go` slip upload/confirm · `slip_parse.go` Tesseract OCR + slip text parser (+ `slip_parse_test.go`)
  - `auth.go` users, sessions, PIN lock, signed slip-image links (+ `auth_test.go`: migration from the pre-auth DB, per-user isolation, PIN flow)
- `frontend/` — Expo SDK 58 + Expo Router (`src/app/`), React Native, TypeScript, runs on web/Android/iOS.
  - `(tabs)/index.tsx` monthly · `(tabs)/yearly.tsx` chart · `(tabs)/accounts.tsx` · `transaction.tsx` add/edit/confirm-slip form · `account.tsx` account form
  - `(tabs)/settings.tsx` lock / change PIN / sign out · `change-pin.tsx`
  - `src/api.ts` all API calls + types · `src/format.ts` money/date/Thai month helpers, colors · `src/state.ts` tiny cross-screen hand-off
  - `src/auth.tsx` AuthProvider (sign-in state, idle lock) · `components/AuthScreens.tsx` sign-in / PIN screens · `components/PinPad.tsx` · `src/tokenStore(.web).ts`
  - Follow `frontend/AGENTS.md` (Expo rules: `npx expo install`, versioned docs).
- `docker-compose.yml` — API **and the built web app** on :8080 (build context = repo root; `backend/Dockerfile` runs
  `expo export` in a node stage, Go serves it from `WEB_DIR` via `web.go`). Data in volume
  `income_expenses_income_expenses_data` (`/app/data`: DB + `slips/` images). Frontend changes reach the live site only after a rebuild.
- The web build calls the API on its own origin; only the dev server (`__DEV__`, port 8081) calls `<host>:8080`.
- Don't start `expo start` with `CI=1` when the owner should see live edits — CI mode disables reloads.

## Commands

```bash
docker compose up -d --build                                                   # backend (Go is not installed locally)
docker run --rm -v "$PWD/backend:/src" -w /src golang:1.25-alpine sh -c "gofmt -l -w . && go vet ./... && go test ./..."
cd frontend && npx tsc --noEmit                                                # typecheck
cd frontend && npx expo start --web --port 8081                                # web UI (also in .claude/launch.json)
```

## Domain rules

- Money is stored as integer **satang** (`amount_satang`); the API speaks baht floats. Convert with `toSatang`/`fromSatang`.
- Categories: รับ(+1) จ่าย(−1) ให้ยืม(−1) กู้(+1) — `direction` decides the sign. Subcategories ("รายการ") belong to one category.
- Transfers (`transfers` table, `transfers.go`) move money between a user's own accounts: they change both account
  balances, cancel out in the all-accounts total, and are never part of in/out totals.
- Balance = sum of account opening balances + signed transactions (+ transfers for a single account). Transactions saved before accounts existed have `account_id NULL` ("ไม่ระบุบัญชี") and still count in the total.
- New/edited transactions **require** an account; payee ("ผู้รับ") and subcategory are optional.
- Bank slips: OCR is **local Tesseract** (owner's choice — do not send slips to external services). A slip is stored in `slips` as `pending` (not in any balance) and becomes a transaction only when confirmed (`POST /api/transactions` with `slip_id`). Deleting that transaction deletes the slip + image.
- Deleting an account with transactions is refused (409).
- Multi-user: `accounts`, `transactions`, `slips` carry `user_id`; **every query must filter by `userID(r)`**. Categories, subcategories, banks and account types are shared.
  Data routes go through `requireUnlocked` (session + PIN unlocked within 5 min). The first user to sign up takes over rows with `user_id NULL`.
- Sign-in methods live in `identities` (`provider`, `subject`) so Google sign-in can be added later without touching `users`.
- Slip images are served via signed short-lived links (`image_url`), not the session token.

## Working on the owner's data

- The Docker volume holds the owner's **real** data. Back up before schema changes:
  `docker compose stop && docker cp income-expenses-api:/app/data/income_expenses.db backups/<name>.db && docker compose start`
- Schema changes go through `migrate()` / `addColumnIfMissing` in `db.go` (existing DBs must upgrade in place).
- Remove any test rows you create; never commit `backups/` or `*.db` (already in `.gitignore`).
- Never sign up a test user on the live DB — it needs a real account to log in, and on a fresh DB the first sign-up takes over all data.
  Test against a copy (run the image on another port with a copied `/app/data`).

## Gotchas (Windows dev machine)

- Git Bash mangles Thai in curl command-line args — send JSON bodies from a UTF-8 file (`--data-binary @file`).
- Files may have CRLF line endings; prefer the Edit tool over `sed`/string replace for multi-line edits.
- Node is v20 but Expo SDK 58 wants ≥ 22.13: it runs with a warning.
- `Alert.alert` is a no-op on react-native-web — use `confirmAsync` / `showInfo` / `showError` from `format.ts`.
