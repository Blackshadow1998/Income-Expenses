package auth

import (
	"database/sql"
	"net/http"
	"strconv"
	"testing"

	"income-expenses/internal/apitest"
)

// newTestServer serves the auth routes plus GET /api/private, a stand-in money route that answers
// with the signed-in user's id.
func newTestServer(t *testing.T, opts ...func(*Service)) (apitest.Client, *sql.DB) {
	db, _ := apitest.OpenDB(t)
	a := New(Options{DB: db})
	for _, o := range opts {
		o(a)
	}
	mux := http.NewServeMux()
	a.Register(mux)
	mux.HandleFunc("GET /api/private", a.RequireUnlocked(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"user_id":` + strconv.FormatInt(UserID(r), 10) + `}`))
	}))
	return apitest.Serve(t, mux), db
}

func TestPINLockAndUnlock(t *testing.T) {
	c, _ := newTestServer(t)

	_, out := c.Do("POST", "/api/auth/signup", "", map[string]string{"username": "myself", "password": "secret-pass"})
	token := out["token"].(string)
	if status, out := c.Do("GET", "/api/private", token, nil); status != http.StatusForbidden || out["code"] != "pin_required" {
		t.Fatalf("before PIN: %d %v", status, out)
	}
	if status, _ := c.Do("POST", "/api/auth/pin", token, map[string]string{"pin": "123456"}); status != http.StatusBadRequest {
		t.Fatalf("weak PIN accepted: %d", status)
	}
	if status, _ := c.Do("POST", "/api/auth/pin", token, map[string]string{"pin": "135790"}); status != http.StatusNoContent {
		t.Fatalf("set PIN: %d", status)
	}
	if status, _ := c.Do("GET", "/api/private", token, nil); status != http.StatusOK {
		t.Fatalf("after PIN: %d", status)
	}

	c.Do("POST", "/api/auth/lock", token, nil)
	if status, out := c.Do("GET", "/api/private", token, nil); status != http.StatusUnauthorized || out["code"] != "locked" {
		t.Fatalf("locked: %d %v", status, out)
	}
	if _, out := c.Do("GET", "/api/auth/me", token, nil); out["locked"] != true {
		t.Fatalf("me while locked: %v", out)
	}
	if status, _ := c.Do("POST", "/api/auth/unlock", token, map[string]string{"pin": "135790"}); status != http.StatusNoContent {
		t.Fatalf("unlock: %d", status)
	}
	if status, _ := c.Do("GET", "/api/private", token, nil); status != http.StatusOK {
		t.Fatalf("after unlock: %d", status)
	}

	// Changing the PIN needs the current one.
	if status, _ := c.Do("POST", "/api/auth/pin", token, map[string]string{"pin": "246802", "current_pin": "000001"}); status != http.StatusUnauthorized {
		t.Fatalf("change PIN with wrong current PIN: %d", status)
	}
	if status, _ := c.Do("POST", "/api/auth/pin", token, map[string]string{"pin": "246802", "current_pin": "135790"}); status != http.StatusNoContent {
		t.Fatalf("change PIN: %d", status)
	}

	// Five wrong PINs in a row sign the session out.
	c.Do("POST", "/api/auth/lock", token, nil)
	for i := 1; i <= maxPINTries; i++ {
		status, out := c.Do("POST", "/api/auth/unlock", token, map[string]string{"pin": "999990"})
		want := "wrong_pin"
		if i == maxPINTries {
			want = "unauthenticated"
		}
		if status != http.StatusUnauthorized || out["code"] != want {
			t.Fatalf("wrong PIN #%d: %d %v", i, status, out)
		}
	}
	if status, _ := c.Do("GET", "/api/auth/me", token, nil); status != http.StatusUnauthorized {
		t.Fatalf("session should be gone, got %d", status)
	}

	// Signing in again works, with the new PIN still set.
	status, out := c.Do("POST", "/api/auth/login", "", map[string]string{"username": "MySelf", "password": "secret-pass"})
	if status != http.StatusOK || out["user"].(map[string]any)["has_pin"] != true {
		t.Fatalf("login: %d %v", status, out)
	}
	// Forgot the PIN: right after the password, a new PIN can be set without the old one.
	token = out["token"].(string)
	if status, out := c.Do("POST", "/api/auth/pin", token, map[string]string{"pin": "975310"}); status != http.StatusNoContent {
		t.Fatalf("reset PIN after password sign-in: %d %v", status, out)
	}
	c.Do("POST", "/api/auth/lock", token, nil)
	if status, _ := c.Do("POST", "/api/auth/unlock", token, map[string]string{"pin": "975310"}); status != http.StatusNoContent {
		t.Fatalf("unlock with reset PIN: %d", status)
	}
}

func TestChangingPINLaterNeedsCurrentPIN(t *testing.T) {
	c, db := newTestServer(t)
	token := c.SignedIn("someone")
	// Pretend the password was entered an hour ago.
	if _, err := db.Exec(`UPDATE sessions SET created_at = datetime('now', '-1 hour')`); err != nil {
		t.Fatal(err)
	}
	if status, out := c.Do("POST", "/api/auth/pin", token, map[string]string{"pin": "975310"}); status != http.StatusUnauthorized || out["code"] != "wrong_pin" {
		t.Fatalf("change PIN without current PIN on an old session: %d %v", status, out)
	}
}

func TestLoginPausesAfterWrongPasswords(t *testing.T) {
	c, _ := newTestServer(t)
	c.Do("POST", "/api/auth/signup", "", map[string]string{"username": "myself", "password": "secret-pass"})
	for i := 0; i < maxLoginTries; i++ {
		if status, _ := c.Do("POST", "/api/auth/login", "", map[string]string{"username": "myself", "password": "wrong-pass"}); status != http.StatusUnauthorized {
			t.Fatalf("wrong password #%d: %d", i+1, status)
		}
	}
	if status, _ := c.Do("POST", "/api/auth/login", "", map[string]string{"username": "myself", "password": "secret-pass"}); status != http.StatusTooManyRequests {
		t.Fatalf("right password while paused: %d, want 429", status)
	}
}
