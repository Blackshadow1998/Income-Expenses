package main

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS categories (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	code       TEXT    NOT NULL UNIQUE,
	name       TEXT    NOT NULL,
	direction  INTEGER NOT NULL CHECK (direction IN (1, -1)), -- 1 = money in, -1 = money out
	sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	txn_date      TEXT    NOT NULL,                       -- YYYY-MM-DD
	category_id   INTEGER NOT NULL REFERENCES categories(id),
	amount_satang INTEGER NOT NULL CHECK (amount_satang > 0), -- stored in satang to avoid float rounding
	note          TEXT    NOT NULL DEFAULT '',
	created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
	updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(txn_date);

INSERT OR IGNORE INTO categories (code, name, direction, sort_order) VALUES
	('income',  'รับ',    1, 1),
	('expense', 'จ่าย',  -1, 2),
	('lend',    'ให้ยืม', -1, 3),
	('borrow',  'กู้',     1, 4),
	-- Repayments, so lending/borrowing nets out per person (see debts.go).
	('lend_return',  'รับคืนเงินยืม',  1, 5),
	('borrow_repay', 'คืนเงินกู้',    -1, 6);

` + subcategoriesTable + `

-- Money accounts (bank accounts, credit cards, wallets, cash...).
CREATE TABLE IF NOT EXISTS banks (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT    NOT NULL UNIQUE,
	sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO banks (name, sort_order) VALUES
	('เงินสด', 1),
	('กสิกรไทย (KBank)', 2),
	('ไทยพาณิชย์ (SCB)', 3),
	('กรุงเทพ (BBL)', 4),
	('กรุงไทย (KTB)', 5),
	('กรุงศรีอยุธยา (Krungsri)', 6),
	('ทหารไทยธนชาต (ttb)', 7),
	('ออมสิน (GSB)', 8),
	('ธ.ก.ส. (BAAC)', 9),
	('อาคารสงเคราะห์ (GH Bank)', 10),
	('ยูโอบี (UOB)', 11),
	('ซีไอเอ็มบี ไทย (CIMB)', 12),
	('เกียรตินาคินภัทร (KKP)', 13),
	('แลนด์ แอนด์ เฮ้าส์ (LH Bank)', 14),
	('ทิสโก้ (TISCO)', 15),
	('ทรูมันนี่ (TrueMoney)', 16),
	('ShopeePay', 17),
	('อื่นๆ', 99);

CREATE TABLE IF NOT EXISTS account_types (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	code       TEXT    NOT NULL UNIQUE,
	name       TEXT    NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO account_types (code, name, sort_order) VALUES
	('savings',     'ออมเงิน',    1),
	('salary',      'เงินเดือน',  2),
	('credit_card', 'บัตรเครดิต', 3),
	('investment',  'ลงทุน',     4),
	('payment',     'จ่ายเงิน',   5);

CREATE TABLE IF NOT EXISTS accounts (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	bank_id        INTEGER NOT NULL REFERENCES banks(id),
	type_id        INTEGER NOT NULL REFERENCES account_types(id),
	name           TEXT    NOT NULL DEFAULT '',  -- optional nickname, e.g. "บัญชีหลัก" or last 4 digits
	opening_satang INTEGER NOT NULL DEFAULT 0,   -- starting amount when the account was added
	created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
	updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

` + slipsTable + `
CREATE INDEX IF NOT EXISTS idx_slips_date ON slips(slip_date);
CREATE INDEX IF NOT EXISTS idx_slips_txn ON slips(transaction_id);

-- Sign-in. accounts, transactions and slips belong to one user (user_id).
CREATE TABLE IF NOT EXISTS users (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT    NOT NULL,                  -- display name
	pin_hash   TEXT    NOT NULL DEFAULT '',       -- bcrypt of the 6-digit unlock PIN; '' = not set yet
	created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ways a user signs in: 'password' (subject = username) now, 'google' (subject = Google account id) later.
CREATE TABLE IF NOT EXISTS identities (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	provider      TEXT    NOT NULL,
	subject       TEXT    NOT NULL,
	secret_hash   TEXT    NOT NULL DEFAULT '',    -- bcrypt of the password; '' for providers without one
	failed_logins INTEGER NOT NULL DEFAULT 0,
	locked_until  INTEGER NOT NULL DEFAULT 0,     -- unix seconds; sign-in paused after repeated wrong passwords
	created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
	UNIQUE (provider, subject)
);

CREATE TABLE IF NOT EXISTS sessions (
	token_hash     TEXT    PRIMARY KEY,           -- sha256 of the bearer token; the token itself is not stored
	user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at     INTEGER NOT NULL,              -- unix seconds
	unlocked_until INTEGER NOT NULL,              -- unix seconds; the PIN is asked again after this
	pin_failures   INTEGER NOT NULL DEFAULT 0,
	created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- What to record when a slip matches: checked top to bottom (sort_order), the first match fills the
-- confirm form. match_kind: 'to' receiver name contains match_text, 'from' sender name contains it,
-- 'self' sender and receiver are the same person (money moved to one's own account).
CREATE TABLE IF NOT EXISTS slip_rules (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name           TEXT    NOT NULL,               -- shown on the slip, e.g. "ค่าหอ"
	match_kind     TEXT    NOT NULL CHECK (match_kind IN ('to', 'from', 'self')),
	match_text     TEXT    NOT NULL DEFAULT '',
	bank_id        INTEGER REFERENCES banks(id),   -- optional: the receiver's bank must be this
	action         TEXT    NOT NULL CHECK (action IN ('transaction', 'transfer')),
	category_id    INTEGER REFERENCES categories(id),
	subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
	account_id     INTEGER REFERENCES accounts(id) ON DELETE SET NULL,    -- default: account at the slip's sender bank
	to_account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,    -- transfer target; default: at the receiver's bank
	payee          TEXT    NOT NULL DEFAULT '',
	note           TEXT    NOT NULL DEFAULT '',
	sort_order     INTEGER NOT NULL DEFAULT 0
);

-- One-time codes for "forgot password", e-mailed to users.email. Only the hash is stored.
CREATE TABLE IF NOT EXISTS password_resets (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	code_hash  TEXT    NOT NULL,
	expires_at INTEGER NOT NULL,                  -- unix seconds
	attempts   INTEGER NOT NULL DEFAULT 0,
	used       INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL                   -- unix seconds
);

-- Money moved between two of a user's own accounts: changes both balances, the total stays
-- the same, and it is neither income nor expense.
CREATE TABLE IF NOT EXISTS transfers (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id         INTEGER NOT NULL REFERENCES users(id),
	txn_date        TEXT    NOT NULL,             -- YYYY-MM-DD
	from_account_id INTEGER NOT NULL REFERENCES accounts(id),
	to_account_id   INTEGER NOT NULL REFERENCES accounts(id),
	amount_satang   INTEGER NOT NULL CHECK (amount_satang > 0),
	note            TEXT    NOT NULL DEFAULT '',
	created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
	updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
	CHECK (from_account_id <> to_account_id)
);

CREATE INDEX IF NOT EXISTS idx_transfers_user_date ON transfers(user_id, txn_date);

-- Monthly rule that creates a normal transaction on day_of_month (clamped to the month's last day).
CREATE TABLE IF NOT EXISTS recurring (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id        INTEGER NOT NULL REFERENCES users(id),
	day_of_month   INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
	category_id    INTEGER NOT NULL REFERENCES categories(id),
	subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
	account_id     INTEGER NOT NULL REFERENCES accounts(id),
	amount_satang  INTEGER NOT NULL CHECK (amount_satang > 0),
	note           TEXT    NOT NULL DEFAULT '',
	payee          TEXT    NOT NULL DEFAULT '',
	next_date      TEXT    NOT NULL,              -- YYYY-MM-DD of the next transaction to create
	active         INTEGER NOT NULL DEFAULT 1,
	created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Monthly spending limit for a category, or for one item of it (subcategory_id set). Same every month.
CREATE TABLE IF NOT EXISTS budgets (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id        INTEGER NOT NULL REFERENCES users(id),
	category_id    INTEGER NOT NULL REFERENCES categories(id),
	subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE CASCADE,
	amount_satang  INTEGER NOT NULL CHECK (amount_satang > 0),
	created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
`

// Each user's item list ("รายการ") shown in the Add/Edit select box, per category.
// user_id is NULL only for rows from before sign-in, until the first user takes them over.
const subcategoriesTable = `
CREATE TABLE IF NOT EXISTS subcategories (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id     INTEGER REFERENCES users(id),
	category_id INTEGER NOT NULL REFERENCES categories(id),
	name        TEXT    NOT NULL,
	sort_order  INTEGER NOT NULL DEFAULT 0,
	UNIQUE (user_id, category_id, name)
);
`

// starterSubcategories is the item list a new user starts with (except the first user, who
// takes over the existing one).
const starterSubcategories = `
INSERT INTO subcategories (user_id, category_id, name, sort_order)
SELECT ?, c.id, s.name, s.sort_order
FROM (
	SELECT 'expense' AS code, 'ค่าอาหาร - น้ำ' AS name, 1 AS sort_order
	UNION ALL SELECT 'expense', 'ค่าเดินทาง', 2
	UNION ALL SELECT 'expense', 'ค่าบัตรเครดิต', 3
	UNION ALL SELECT 'expense', 'ค่าน้ำ ค่าไฟ ค่าเน็ต', 4
	UNION ALL SELECT 'expense', 'ช้อปปิ้ง', 5
	UNION ALL SELECT 'income',  'เงินเดือน', 1
	UNION ALL SELECT 'income',  'เงินคืน', 2
) s JOIN categories c ON c.code = s.code`

// Uploaded bank slips. A slip stays "pending" (not counted in any balance) until the
// user confirms it, which creates the transaction and links it here.
const slipsTable = `
CREATE TABLE IF NOT EXISTS slips (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id        INTEGER REFERENCES users(id),
	image_file     TEXT    NOT NULL,                -- file name inside the slips directory
	file_hash      TEXT    NOT NULL,                -- sha256, blocks uploading the same image twice
	slip_date      TEXT    NOT NULL,                -- YYYY-MM-DD (upload day when not readable)
	date_found     INTEGER NOT NULL DEFAULT 0,
	amount_satang  INTEGER NOT NULL DEFAULT 0,      -- 0 = not readable
	from_name      TEXT    NOT NULL DEFAULT '',     -- sender account name
	to_name        TEXT    NOT NULL DEFAULT '',     -- receiver account name
	ref            TEXT    NOT NULL DEFAULT '',
	bank_id        INTEGER REFERENCES banks(id),    -- sender bank guessed from the slip
	ocr_text       TEXT    NOT NULL DEFAULT '',
	status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
	transaction_id INTEGER REFERENCES transactions(id),
	created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
	UNIQUE (user_id, file_hash)
);
`

// migrations run after schema for databases created by an older version.
func migrate(db *sql.DB) error {
	if err := addColumnIfMissing(db, "transactions", "subcategory_id", "INTEGER REFERENCES subcategories(id)"); err != nil {
		return err
	}
	if err := addColumnIfMissing(db, "transactions", "account_id", "INTEGER REFERENCES accounts(id)"); err != nil {
		return err
	}
	if err := addColumnIfMissing(db, "transactions", "payee", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	// Rows from before sign-in existed keep user_id NULL until the first user signs up and takes them over.
	if err := addColumnIfMissing(db, "accounts", "user_id", "INTEGER REFERENCES users(id)"); err != nil {
		return err
	}
	if err := addColumnIfMissing(db, "transactions", "user_id", "INTEGER REFERENCES users(id)"); err != nil {
		return err
	}
	if err := addColumnIfMissing(db, "transactions", "recurring_id", "INTEGER REFERENCES recurring(id) ON DELETE SET NULL"); err != nil {
		return err
	}
	// Forgot password: e-mail to send codes to, a temporary password valid for a day, and sessions
	// signed in with it must change the password first.
	for _, c := range []struct{ table, column, def string }{
		{"users", "email", "TEXT NOT NULL DEFAULT ''"},
		{"identities", "temp_hash", "TEXT NOT NULL DEFAULT ''"},
		{"identities", "temp_expires", "INTEGER NOT NULL DEFAULT 0"},
		{"sessions", "must_change_password", "INTEGER NOT NULL DEFAULT 0"},
	} {
		if err := addColumnIfMissing(db, c.table, c.column, c.def); err != nil {
			return err
		}
	}
	if _, err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email <> ''`); err != nil {
		return err
	}
	if err := upgradeSlips(db); err != nil {
		return fmt.Errorf("upgrade slips: %w", err)
	}
	// After the rebuild above (it only copies the columns it knows): the receiver's bank, and slips
	// confirmed as a transfer between own accounts (slip rules).
	if err := addColumnIfMissing(db, "slips", "to_bank_id", "INTEGER REFERENCES banks(id)"); err != nil {
		return err
	}
	if err := addColumnIfMissing(db, "slips", "transfer_id", "INTEGER REFERENCES transfers(id)"); err != nil {
		return err
	}
	if err := upgradeSubcategories(db); err != nil {
		return fmt.Errorf("upgrade subcategories: %w", err)
	}
	_, err := db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
		CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, txn_date);
		CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
		CREATE INDEX IF NOT EXISTS idx_slips_user_date ON slips(user_id, slip_date);`)
	return err
}

// upgradeSlips moves a slips table from before sign-in (no user_id, file_hash unique across
// everyone) to the per-user shape. SQLite can't drop a UNIQUE constraint in place, so it is copied.
func upgradeSlips(db *sql.DB) error {
	var has bool
	if err := db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM pragma_table_info('slips') WHERE name = 'user_id')`,
	).Scan(&has); err != nil || has {
		return err
	}
	const cols = `id, image_file, file_hash, slip_date, date_found, amount_satang, from_name, to_name,
		ref, bank_id, ocr_text, status, transaction_id, created_at`
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`ALTER TABLE slips RENAME TO slips_old`,
		slipsTable,
		`INSERT INTO slips (` + cols + `) SELECT ` + cols + ` FROM slips_old`,
		`DROP TABLE slips_old`, // also drops its indexes, recreated below
		`CREATE INDEX IF NOT EXISTS idx_slips_date ON slips(slip_date)`,
		`CREATE INDEX IF NOT EXISTS idx_slips_txn ON slips(transaction_id)`,
	} {
		if _, err := tx.Exec(q); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// upgradeSubcategories moves the shared item list from before per-user lists to the first user
// (or leaves it unowned until someone signs up). The UNIQUE key changes, so the table is rebuilt;
// transactions reference it, so foreign keys are off meanwhile and checked before committing.
func upgradeSubcategories(db *sql.DB) error {
	var has bool
	if err := db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM pragma_table_info('subcategories') WHERE name = 'user_id')`,
	).Scan(&has); err != nil || has {
		return err
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer db.Exec(`PRAGMA foreign_keys = ON`)
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Build the new table under a temporary name and rename it last: renaming the old table instead
	// would make SQLite repoint transactions' REFERENCES at the copy that gets dropped.
	for _, q := range []string{
		strings.Replace(subcategoriesTable, "subcategories (", "subcategories_new (", 1),
		`INSERT INTO subcategories_new (id, user_id, category_id, name, sort_order)
		 SELECT id, (SELECT MIN(id) FROM users), category_id, name, sort_order FROM subcategories`,
		`DROP TABLE subcategories`,
		`ALTER TABLE subcategories_new RENAME TO subcategories`,
	} {
		if _, err := tx.Exec(q); err != nil {
			return err
		}
	}
	var broken int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM pragma_foreign_key_check`).Scan(&broken); err != nil {
		return err
	}
	if broken > 0 {
		return fmt.Errorf("%d broken references after rebuild", broken)
	}
	return tx.Commit()
}

func addColumnIfMissing(db *sql.DB, table, column, def string) error {
	var has bool
	if err := db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM pragma_table_info(?) WHERE name = ?)`, table, column,
	).Scan(&has); err != nil {
		return err
	}
	if has {
		return nil
	}
	_, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, table, column, def))
	return err
}

func openDB(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite allows a single writer; one connection keeps things simple and safe.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}
