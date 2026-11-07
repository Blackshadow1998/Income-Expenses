package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
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

type testClient struct {
	t   *testing.T
	srv *httptest.Server
}

func (c testClient) do(method, path, token string, body any) (int, map[string]any) {
	out := map[string]any{}
	status := c.doInto(method, path, token, body, &out)
	return status, out
}

// doInto decodes the response body into out (e.g. a slice for list endpoints).
func (c testClient) doInto(method, path, token string, body, out any) int {
	c.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, c.srv.URL+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	_ = json.NewDecoder(res.Body).Decode(out)
	return res.StatusCode
}

// signedIn signs up a user, sets a PIN and returns the session token.
func (c testClient) signedIn(username string) string {
	c.t.Helper()
	status, out := c.do("POST", "/api/auth/signup", "", map[string]string{"username": username, "password": "password-" + username})
	if status != http.StatusCreated {
		c.t.Fatalf("signup %s: %d %v", username, status, out)
	}
	token := out["token"].(string)
	if status, out := c.do("POST", "/api/auth/pin", token, map[string]string{"pin": "135790"}); status != http.StatusNoContent {
		c.t.Fatalf("set pin: %d %v", status, out)
	}
	return token
}

func newTestServer(t *testing.T, opts ...func(*API)) (testClient, *sql.DB) {
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

	db, err := openDB(path)
	if err != nil {
		t.Fatalf("migrate old database: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	api := &API{db: db, slipsDir: dir, imageKey: []byte("test-key")}
	for _, o := range opts {
		o(api)
	}
	srv := httptest.NewServer(api.routes())
	t.Cleanup(srv.Close)
	return testClient{t: t, srv: srv}, db
}

func TestFirstUserTakesOverOldDataAndUsersAreSeparate(t *testing.T) {
	c, db := newTestServer(t)

	if status, out := c.do("GET", "/api/accounts", "", nil); status != http.StatusUnauthorized || out["code"] != "unauthenticated" {
		t.Fatalf("no token: %d %v", status, out)
	}

	owner := c.signedIn("owner")
	_, out := c.do("GET", "/api/transactions?month=2026-11", owner, nil)
	if items := out["items"].([]any); len(items) != 1 {
		t.Fatalf("owner should see the old transaction, got %v", out)
	}
	if pending := out["pending"].([]any); len(pending) != 1 {
		t.Fatalf("owner should see the old slip, got %v", out)
	}
	if out["balance"].(float64) != 950 {
		t.Fatalf("owner balance = %v, want 950", out["balance"])
	}

	other := c.signedIn("other")
	_, out = c.do("GET", "/api/transactions?month=2026-11", other, nil)
	if len(out["items"].([]any)) != 0 || len(out["pending"].([]any)) != 0 || out["balance"].(float64) != 0 {
		t.Fatalf("second user must start empty, got %v", out)
	}
	if status, _ := c.do("GET", "/api/transactions/1", other, nil); status != http.StatusNotFound {
		t.Fatalf("other user's transaction: status %d, want 404", status)
	}
	if status, _ := c.do("DELETE", "/api/accounts/1", other, nil); status != http.StatusNotFound {
		t.Fatalf("deleting other user's account: status %d, want 404", status)
	}
	// Recording against someone else's account is refused.
	status, out := c.do("POST", "/api/transactions", other, map[string]any{
		"date": "2026-11-03", "category_id": 2, "account_id": 1, "amount": 10,
	})
	if status != http.StatusBadRequest {
		t.Fatalf("transaction on other user's account: %d %v", status, out)
	}

	// The same slip image may belong to both users.
	if _, err := db.Exec(`INSERT INTO slips (user_id, image_file, file_hash, slip_date) VALUES (2, 'b.png', 'hash-a', '2026-11-02')`); err != nil {
		t.Fatalf("per-user slip hash: %v", err)
	}

	if status, out := c.do("POST", "/api/auth/signup", "", map[string]string{"username": "OWNER", "password": "whatever-123"}); status != http.StatusConflict {
		t.Fatalf("duplicate username: %d %v", status, out)
	}
}

func TestPINLockAndUnlock(t *testing.T) {
	c, _ := newTestServer(t)

	_, out := c.do("POST", "/api/auth/signup", "", map[string]string{"username": "myself", "password": "secret-pass"})
	token := out["token"].(string)
	if status, out := c.do("GET", "/api/accounts", token, nil); status != http.StatusForbidden || out["code"] != "pin_required" {
		t.Fatalf("before PIN: %d %v", status, out)
	}
	if status, _ := c.do("POST", "/api/auth/pin", token, map[string]string{"pin": "123456"}); status != http.StatusBadRequest {
		t.Fatalf("weak PIN accepted: %d", status)
	}
	if status, _ := c.do("POST", "/api/auth/pin", token, map[string]string{"pin": "135790"}); status != http.StatusNoContent {
		t.Fatalf("set PIN: %d", status)
	}
	if status, _ := c.do("GET", "/api/accounts", token, nil); status != http.StatusOK {
		t.Fatalf("after PIN: %d", status)
	}

	c.do("POST", "/api/auth/lock", token, nil)
	if status, out := c.do("GET", "/api/accounts", token, nil); status != http.StatusUnauthorized || out["code"] != "locked" {
		t.Fatalf("locked: %d %v", status, out)
	}
	if _, out := c.do("GET", "/api/auth/me", token, nil); out["locked"] != true {
		t.Fatalf("me while locked: %v", out)
	}
	if status, _ := c.do("POST", "/api/auth/unlock", token, map[string]string{"pin": "135790"}); status != http.StatusNoContent {
		t.Fatalf("unlock: %d", status)
	}
	if status, _ := c.do("GET", "/api/accounts", token, nil); status != http.StatusOK {
		t.Fatalf("after unlock: %d", status)
	}

	// Changing the PIN needs the current one.
	if status, _ := c.do("POST", "/api/auth/pin", token, map[string]string{"pin": "246802", "current_pin": "000001"}); status != http.StatusUnauthorized {
		t.Fatalf("change PIN with wrong current PIN: %d", status)
	}
	if status, _ := c.do("POST", "/api/auth/pin", token, map[string]string{"pin": "246802", "current_pin": "135790"}); status != http.StatusNoContent {
		t.Fatalf("change PIN: %d", status)
	}

	// Five wrong PINs in a row sign the session out.
	c.do("POST", "/api/auth/lock", token, nil)
	for i := 1; i <= maxPINTries; i++ {
		status, out := c.do("POST", "/api/auth/unlock", token, map[string]string{"pin": "999990"})
		want := "wrong_pin"
		if i == maxPINTries {
			want = "unauthenticated"
		}
		if status != http.StatusUnauthorized || out["code"] != want {
			t.Fatalf("wrong PIN #%d: %d %v", i, status, out)
		}
	}
	if status, _ := c.do("GET", "/api/auth/me", token, nil); status != http.StatusUnauthorized {
		t.Fatalf("session should be gone, got %d", status)
	}

	// Signing in again works, with the new PIN still set.
	status, out := c.do("POST", "/api/auth/login", "", map[string]string{"username": "MySelf", "password": "secret-pass"})
	if status != http.StatusOK || out["user"].(map[string]any)["has_pin"] != true {
		t.Fatalf("login: %d %v", status, out)
	}
	// Forgot the PIN: right after the password, a new PIN can be set without the old one.
	token = out["token"].(string)
	if status, out := c.do("POST", "/api/auth/pin", token, map[string]string{"pin": "975310"}); status != http.StatusNoContent {
		t.Fatalf("reset PIN after password sign-in: %d %v", status, out)
	}
	c.do("POST", "/api/auth/lock", token, nil)
	if status, _ := c.do("POST", "/api/auth/unlock", token, map[string]string{"pin": "975310"}); status != http.StatusNoContent {
		t.Fatalf("unlock with reset PIN: %d", status)
	}
}

func TestChangingPINLaterNeedsCurrentPIN(t *testing.T) {
	c, db := newTestServer(t)
	token := c.signedIn("someone")
	// Pretend the password was entered an hour ago.
	if _, err := db.Exec(`UPDATE sessions SET created_at = datetime('now', '-1 hour')`); err != nil {
		t.Fatal(err)
	}
	if status, out := c.do("POST", "/api/auth/pin", token, map[string]string{"pin": "975310"}); status != http.StatusUnauthorized || out["code"] != "wrong_pin" {
		t.Fatalf("change PIN without current PIN on an old session: %d %v", status, out)
	}
}

func TestLoginPausesAfterWrongPasswords(t *testing.T) {
	c, _ := newTestServer(t)
	c.do("POST", "/api/auth/signup", "", map[string]string{"username": "myself", "password": "secret-pass"})
	for i := 0; i < maxLoginTries; i++ {
		if status, _ := c.do("POST", "/api/auth/login", "", map[string]string{"username": "myself", "password": "wrong-pass"}); status != http.StatusUnauthorized {
			t.Fatalf("wrong password #%d: %d", i+1, status)
		}
	}
	if status, _ := c.do("POST", "/api/auth/login", "", map[string]string{"username": "myself", "password": "secret-pass"}); status != http.StatusTooManyRequests {
		t.Fatalf("right password while paused: %d, want 429", status)
	}
}

func TestSlipImageNeedsValidSignature(t *testing.T) {
	c, _ := newTestServer(t)
	if status, _ := c.do("GET", "/api/slips/1/image?exp=9999999999&sig=bad", "", nil); status != http.StatusForbidden {
		t.Fatalf("bad signature: %d", status)
	}
}
