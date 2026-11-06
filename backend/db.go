package main

import (
	"database/sql"
	"fmt"

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
	('borrow',  'กู้',     1, 4);

-- Item list shown in the Add/Edit select box, per category.
CREATE TABLE IF NOT EXISTS subcategories (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	category_id INTEGER NOT NULL REFERENCES categories(id),
	name        TEXT    NOT NULL,
	sort_order  INTEGER NOT NULL DEFAULT 0,
	UNIQUE (category_id, name)
);

INSERT OR IGNORE INTO subcategories (category_id, name, sort_order)
SELECT c.id, s.name, s.sort_order
FROM (
	SELECT 'expense' AS code, 'ค่าอาหาร - น้ำ' AS name, 1 AS sort_order
	UNION ALL SELECT 'expense', 'ค่าบัตรเครดิต', 2
	UNION ALL SELECT 'expense', 'โอนให้ครอบครัว', 3
	UNION ALL SELECT 'expense', 'โอนทำบุญ', 4
	UNION ALL SELECT 'expense', 'เลี้ยงอาหารเพื่อน', 5
	UNION ALL SELECT 'expense', 'ค่า Shopee', 6
	UNION ALL SELECT 'income',  'เงินเดือน', 1
	UNION ALL SELECT 'income',  'เพื่อนจ่ายเงิน (หารอาหาร, หาร App)', 2
	UNION ALL SELECT 'income',  'เงินคืน', 3
) s JOIN categories c ON c.code = s.code;

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

-- Uploaded bank slips. A slip stays "pending" (not counted in any balance) until the
-- user confirms it, which creates the transaction and links it here.
CREATE TABLE IF NOT EXISTS slips (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	image_file     TEXT    NOT NULL,                -- file name inside the slips directory
	file_hash      TEXT    NOT NULL UNIQUE,         -- sha256, blocks uploading the same image twice
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
	created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slips_date ON slips(slip_date);
CREATE INDEX IF NOT EXISTS idx_slips_txn ON slips(transaction_id);
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
	_, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`)
	return err
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
