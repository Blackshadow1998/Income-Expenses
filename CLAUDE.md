# Income / Expenses (รายรับรายจ่าย)

Personal income/expense tracker. The owner writes in Thai; the UI is Thai and answers should be in Thai.
See README.md for features, API table and run commands.

## Stack and layout

- `backend/` — Go 1.25, standard `net/http` (Go 1.22+ method routing), SQLite via `modernc.org/sqlite` (pure Go, no CGO). Runs in Docker.
  - `main.go` server + graceful shutdown · `db.go` schema/seed/migrations · `handlers.go` transactions, months, yearly, payees
  - `accounts.go` accounts/banks/types · `slips.go` slip upload/confirm · `slip_parse.go` Tesseract OCR + slip text parser (+ `slip_parse_test.go`)
- `frontend/` — Expo SDK 58 + Expo Router (`src/app/`), React Native, TypeScript, runs on web/Android/iOS.
  - `(tabs)/index.tsx` monthly · `(tabs)/yearly.tsx` chart · `(tabs)/accounts.tsx` · `transaction.tsx` add/edit/confirm-slip form · `account.tsx` account form
  - `src/api.ts` all API calls + types · `src/format.ts` money/date/Thai month helpers, colors · `src/state.ts` tiny cross-screen hand-off
  - Follow `frontend/AGENTS.md` (Expo rules: `npx expo install`, versioned docs).
- `docker-compose.yml` — API on :8080, data in volume `income_expenses_income_expenses_data` (`/app/data`: DB + `slips/` images).

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
- Balance = sum of account opening balances + signed transactions. Transactions saved before accounts existed have `account_id NULL` ("ไม่ระบุบัญชี") and still count in the total.
- New/edited transactions **require** an account; payee ("ผู้รับ") and subcategory are optional.
- Bank slips: OCR is **local Tesseract** (owner's choice — do not send slips to external services). A slip is stored in `slips` as `pending` (not in any balance) and becomes a transaction only when confirmed (`POST /api/transactions` with `slip_id`). Deleting that transaction deletes the slip + image.
- Deleting an account with transactions is refused (409).

## Working on the owner's data

- The Docker volume holds the owner's **real** data. Back up before schema changes:
  `docker compose stop && docker cp income-expenses-api:/app/data/income_expenses.db backups/<name>.db && docker compose start`
- Schema changes go through `migrate()` / `addColumnIfMissing` in `db.go` (existing DBs must upgrade in place).
- Remove any test rows you create; never commit `backups/` or `*.db` (already in `.gitignore`).

## Gotchas (Windows dev machine)

- Git Bash mangles Thai in curl command-line args — send JSON bodies from a UTF-8 file (`--data-binary @file`).
- Files may have CRLF line endings; prefer the Edit tool over `sed`/string replace for multi-line edits.
- Node is v20 but Expo SDK 58 wants ≥ 22.13: it runs with a warning.
- `Alert.alert` is a no-op on react-native-web — use `confirmAsync` / `showInfo` / `showError` from `format.ts`.
