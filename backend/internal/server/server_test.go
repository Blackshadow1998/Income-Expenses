package server

import (
	"database/sql"
	"net/http"
	"path/filepath"
	"testing"

	"income-expenses/internal/apitest"
	"income-expenses/internal/auth"
	"income-expenses/internal/database"
	"income-expenses/internal/images"
)

// oldSchema is the shape of a database from before sign-in existed.
const oldSchema = `
CREATE TABLE subcategories (
	id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, name TEXT NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE (category_id, name));
INSERT INTO subcategories (category_id, name, sort_order) VALUES (2, 'ค่าอาหาร - น้ำ', 1);
CREATE TABLE transactions (
	id INTEGER PRIMARY KEY AUTOINCREMENT, txn_date TEXT NOT NULL, category_id INTEGER NOT NULL,
	amount_satang INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
	subcategory_id INTEGER REFERENCES subcategories(id),
	created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE accounts (
	id INTEGER PRIMARY KEY AUTOINCREMENT, bank_id INTEGER NOT NULL, type_id INTEGER NOT NULL,
	name TEXT NOT NULL DEFAULT '', opening_satang INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE slips (
	id INTEGER PRIMARY KEY AUTOINCREMENT, image_file TEXT NOT NULL, file_hash TEXT NOT NULL UNIQUE,
	slip_date TEXT NOT NULL, date_found INTEGER NOT NULL DEFAULT 0, amount_satang INTEGER NOT NULL DEFAULT 0,
	from_name TEXT NOT NULL DEFAULT '', to_name TEXT NOT NULL DEFAULT '', ref TEXT NOT NULL DEFAULT '',
	bank_id INTEGER, ocr_text TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
	transaction_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT INTO accounts (bank_id, type_id, name, opening_satang) VALUES (2, 2, 'old', 100000);
INSERT INTO transactions (txn_date, category_id, amount_satang, note, subcategory_id) VALUES ('2026-11-01', 2, 5000, 'old expense', 1);
INSERT INTO slips (image_file, file_hash, slip_date) VALUES ('a.png', 'hash-a', '2026-11-02');
`

// newTestServer runs the whole API on a database migrated from the pre-sign-in schema (oldSchema).
func newTestServer(t *testing.T) (apitest.Client, *sql.DB) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	old, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := old.Exec(oldSchema); err != nil {
		t.Fatal(err)
	}
	old.Close()

	db, err := database.Open(path)
	if err != nil {
		t.Fatalf("migrate old database: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	api := newAPI(db, images.New(dir, []byte("test-key")), "", auth.New(auth.Options{DB: db}))
	return apitest.Serve(t, api.Handler()), db
}

func TestFirstUserTakesOverOldDataAndUsersAreSeparate(t *testing.T) {
	c, db := newTestServer(t)

	if status, out := c.Do("GET", "/api/accounts", "", nil); status != http.StatusUnauthorized || out["code"] != "unauthenticated" {
		t.Fatalf("no token: %d %v", status, out)
	}

	owner := c.SignedIn("owner")
	_, out := c.Do("GET", "/api/transactions?month=2026-11", owner, nil)
	if items := out["items"].([]any); len(items) != 1 {
		t.Fatalf("owner should see the old transaction, got %v", out)
	}
	if pending := out["pending"].([]any); len(pending) != 1 {
		t.Fatalf("owner should see the old slip, got %v", out)
	}
	if out["balance"].(float64) != 950 {
		t.Fatalf("owner balance = %v, want 950", out["balance"])
	}

	other := c.SignedIn("other")
	_, out = c.Do("GET", "/api/transactions?month=2026-11", other, nil)
	if len(out["items"].([]any)) != 0 || len(out["pending"].([]any)) != 0 || out["balance"].(float64) != 0 {
		t.Fatalf("second user must start empty, got %v", out)
	}
	if status, _ := c.Do("GET", "/api/transactions/1", other, nil); status != http.StatusNotFound {
		t.Fatalf("other user's transaction: status %d, want 404", status)
	}
	if status, _ := c.Do("DELETE", "/api/accounts/1", other, nil); status != http.StatusNotFound {
		t.Fatalf("deleting other user's account: status %d, want 404", status)
	}
	// Recording against someone else's account is refused.
	status, out := c.Do("POST", "/api/transactions", other, map[string]any{
		"date": "2026-11-03", "category_id": 2, "account_id": 1, "amount": 10,
	})
	if status != http.StatusBadRequest {
		t.Fatalf("transaction on other user's account: %d %v", status, out)
	}

	// The same slip image may belong to both users.
	if _, err := db.Exec(`INSERT INTO slips (user_id, image_file, file_hash, slip_date) VALUES (2, 'b.png', 'hash-a', '2026-11-02')`); err != nil {
		t.Fatalf("per-user slip hash: %v", err)
	}

	if status, out := c.Do("POST", "/api/auth/signup", "", map[string]string{"username": "OWNER", "password": "whatever-123"}); status != http.StatusConflict {
		t.Fatalf("duplicate username: %d %v", status, out)
	}
}

func TestSlipImageNeedsValidSignature(t *testing.T) {
	c, _ := newTestServer(t)
	if status, _ := c.Do("GET", "/api/slips/1/image?exp=9999999999&sig=bad", "", nil); status != http.StatusForbidden {
		t.Fatalf("bad signature: %d", status)
	}
}
